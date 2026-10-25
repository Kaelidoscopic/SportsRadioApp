package com.sportsradio.tv.room

import org.json.JSONObject

interface RoomSocket {
    val id: String?
    val connected: Boolean
    fun on(event: String, callback: (JSONObject) -> Unit)
    fun emit(event: String, payload: JSONObject = JSONObject())
    fun request(event: String, payload: JSONObject, callback: (JSONObject?) -> Unit)
    fun connect()
    fun close()
}
data class Ownership(val backend: String, val roomCode: String, val roomName: String, val credential: String, val expiresAt: Long) {
    override fun toString() = "Ownership(roomCode=$roomCode, credential=[redacted])"
}
interface OwnershipStore { fun load(): Ownership?; fun save(record: Ownership); fun clear() }
fun interface RecoveryScheduler { fun after(ms: Long, task: () -> Unit): () -> Unit }
data class RoomState(val connected: Boolean = false, val ready: Boolean = false, val busy: Boolean = false,
    val code: String = "", val name: String = "", val members: Set<String> = emptySet(), val broadcasting: Boolean = false,
    val message: String = "Connect to create or recover a room.")

/** Main-thread serialized, independently testable; ownership is never a room-code privilege. */
class RoomSession(private val socket: RoomSocket, private val store: OwnershipStore,
    private val backend: String, private val changed: (RoomState) -> Unit,
    private val signal: (String, JSONObject) -> Unit,
    private val retry: RecoveryScheduler? = null, private val now: () -> Long = System::currentTimeMillis) {
    var state = RoomState(); private set
    private var ownership: Ownership? = null
    private var generation = 0L
    private var closed = false
    private var recoverUntil = 0L
    private var cancelRecovery: (() -> Unit)? = null
    private fun cancelRetry() { cancelRecovery?.invoke(); cancelRecovery = null }
    private fun publish(value: RoomState) { state = value; changed(value) }
    init {
        socket.on("connect") {
            if (!closed) {
                recoverUntil = now() + 60000
                publish(state.copy(connected = true, message = "Connected. Create or recover a room."))
                if (ownership != null) recover()
            }
        }
        socket.on("disconnect") {
            cancelRetry()
            generation++
            publish(state.copy(connected = false, ready = false, busy = false, broadcasting = false,
                members = emptySet(), message = "Network lost. Reconnecting; media stopped."))
        }
        socket.on("connect_error") { publish(state.copy(message = "Cannot reach backend. Check TV network and retry.")) }
        socket.on("room-updated") { data ->
            if (state.ready && data.optString("roomId") == state.code) publish(state.copy(members = members(data)))
        }
        socket.on("room-closed") {
            cancelRetry()
            generation++; ownership = null
            try { store.clear() } catch (_: Exception) { /* Never reuse closed ownership in memory. */ }
            publish(RoomState(connected = socket.connected, message = "Room closed. Create a new room explicitly."))
        }
        socket.on("error-message") { publish(state.copy(message = "Backend rejected an operation. Stop broadcasting and retry.")) }
        for (event in listOf("listener-joined", "stream-requested")) socket.on(event) { data ->
            if (state.ready && data.optString("listenerSocketId") in state.members) signal(event, data)
        }
        for (event in listOf("webrtc-answer", "webrtc-ice-candidate")) socket.on(event) { data ->
            if (state.ready && data.optString("sender") in state.members) signal(event, data)
        }
    }
    fun connect() {
        if (closed) return
        try { ownership = store.load()?.takeIf { it.backend == backend } }
        catch (_: Exception) { publish(state.copy(message = "Saved ownership cannot be decrypted. Create a new room explicitly.")); return }
        socket.connect()
    }
    private fun members(data: JSONObject): Set<String> {
        val values = data.optJSONArray("members") ?: return emptySet()
        return (0 until values.length()).mapNotNull { values.optString(it).takeIf { id -> id.isNotBlank() && id != socket.id } }.toSet()
    }
    private fun request(event: String, data: JSONObject, accept: (JSONObject) -> Unit) {
        if (closed || !state.connected || state.busy || state.ready) return
        val current = generation
        publish(state.copy(busy = true, message = "Authenticating room ownership…"))
        socket.request(event, data) { result ->
            if (closed || current != generation) return@request
            if (result?.optBoolean("ok") != true) {
                publish(state.copy(busy = false, ready = false, message = if (result == null)
                    "Room request timed out. Reconnect before retrying; ownership is uncertain."
                    else "Room ownership denied/expired or code unavailable. Create a new room explicitly."))
                if (result == null) {
                    generation++; socket.close()
                    publish(state.copy(connected = false, message = "Request timed out. Use Connect / Recover before retrying."))
                } else if (event == "desktop:recover" && result.optString("error") == "RECOVERY_DENIED" &&
                    retry != null && now() < recoverUntil) {
                    // A dead process's polling/WS connection may still be awaiting server timeout.
                    // Retry the SAME secret; never weaken host identity or implicitly register.
                    publish(state.copy(message = "Recovery not yet accepted. Retrying saved ownership while the old connection closes…"))
                    cancelRetry()
                    cancelRecovery = retry.after(2000) {
                        cancelRecovery = null
                        if (!closed && current == generation && !state.ready && state.connected) {
                            if (now() < recoverUntil) recover()
                            else publish(state.copy(message = "Recovery retry window ended. Create a new room explicitly or reconnect to retry saved ownership."))
                        }
                    }
                }
            } else {
                try {
                    require(result.getString("roomId").matches(Regex("[A-Z0-9]{1,32}")))
                    require(result.getLong("expiresAt") > 0)
                    require(result.optJSONArray("members") != null)
                    accept(result)
                } catch (_: Exception) {
                    socket.emit("end-room"); ownership = null
                    publish(state.copy(busy = false, ready = false, message = "Secure ownership persistence failed. Registration cancelled."))
                    return@request
                }
                cancelRetry(); recoverUntil = 0
                publish(state.copy(busy = false, ready = true, code = result.getString("roomId"),
                    name = result.optString("roomName"), members = members(result), message = "Room ready. Start Broadcasting for playback capture."))
            }
        }
    }
    fun register(name: String) {
        if (state.busy) return
        cancelRetry(); recoverUntil = 0
        request("desktop:register", JSONObject().put("roomName", name.trim().take(120))) { data ->
            val record = Ownership(backend, data.getString("roomId"), data.optString("roomName"), data.getString("credential"), data.getLong("expiresAt"))
            require(record.credential.matches(Regex("[a-f0-9]{64}")))
            store.save(record); ownership = record
        }
    }
    fun recover() {
        val record = ownership ?: return
        request("desktop:recover", JSONObject().put("roomCode", record.roomCode).put("credential", record.credential)) { /* Existing secure secret remains local. */ }
    }
    fun broadcast(active: Boolean) {
        if (active && (!state.ready || !socket.connected)) return
        if (state.ready && socket.connected) socket.emit(if (active) "broadcast-started" else "broadcast-stopped")
        publish(state.copy(broadcasting = active))
    }
    fun send(event: String, target: String, payload: JSONObject) {
        if (!state.ready || !state.broadcasting || target !in state.members ||
            event !in setOf("webrtc-offer", "webrtc-ice-candidate")) return
        socket.emit(event, JSONObject(payload.toString()).put("target", target))
    }
    fun end() {
        cancelRetry(); recoverUntil = 0
        generation++
        if (state.ready) socket.emit("end-room")
        ownership = null
        val cleared = try { store.clear(); true } catch (_: Exception) { false }
        publish(RoomState(connected = socket.connected, message = if (cleared) "Room ended." else "Room ended. Saved ownership could not be removed; it is revoked on the server."))
    }
    fun close() {
        cancelRetry()
        closed = true; generation++
        if (state.ready) socket.emit("broadcast-stopped")
        socket.close() // Preserve saved ownership and server reconnect grace; no implicit takeover.
    }
}
