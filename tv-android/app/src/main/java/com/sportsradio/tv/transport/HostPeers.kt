package com.sportsradio.tv.transport

import org.json.JSONObject

interface PeerDriver {
    fun createOffer(done: (String?) -> Unit)
    fun setLocal(sdp: String, done: (Boolean) -> Unit)
    fun setRemote(sdp: String, done: (Boolean) -> Unit)
    fun addIce(candidate: JSONObject)
    fun close()
}
interface Deadline { fun after(ms: Long, action: () -> Unit): () -> Unit }

/** One peer per member. All calls/callbacks are serialized by the native port on main. */
class HostPeers(private val create: (String, (JSONObject) -> Unit, (String) -> Unit) -> PeerDriver,
    private val signal: (String, String, JSONObject) -> Unit, private val deadline: Deadline,
    private val report: (String) -> Unit) {
    private class Entry {
        lateinit var pc: PeerDriver
        var offerSent = false; var creating = true; var answered = false; var applying = false; var retry = false
        val local = mutableListOf<JSONObject>(); val remote = mutableListOf<JSONObject>()
        var cancel: (() -> Unit)? = null
    }
    private val peers = mutableMapOf<String, Entry>()
    fun offer(id: String, force: Boolean = false) {
        val previous = peers[id]
        if (previous != null) {
            if (!force) return
            if (previous.creating || !previous.answered || previous.applying) { previous.retry = true; return }
            remove(id)
        }
        val entry = Entry(); peers[id] = entry
        fun current() = peers[id] === entry
        try {
            entry.pc = create(id, { candidate ->
                if (current()) {
                    if (!entry.offerSent) { if (entry.local.size < 256) entry.local.add(candidate) }
                    else signal("webrtc-ice-candidate", id, JSONObject().put("candidate", candidate))
                }
            }, { state -> if (current()) {
                report("Listener peer: $state")
                if (state in setOf("failed", "closed")) remove(id)
            } })
            entry.cancel = deadline.after(12000) {
                if (current() && !entry.answered) {
                    val retry = entry.retry; remove(id); report("Listener answer timed out. Retry listening on the phone.")
                    if (retry) offer(id)
                }
            }
            entry.pc.createOffer { sdp ->
                if (!current()) return@createOffer
                if (sdp == null) { remove(id); report("Could not create audio offer."); return@createOffer }
                entry.pc.setLocal(sdp) { success ->
                    if (!current()) return@setLocal
                    if (!success) { remove(id); report("Could not apply local audio offer."); return@setLocal }
                    signal("webrtc-offer", id, JSONObject().put("offer", JSONObject().put("type", "offer").put("sdp", sdp)))
                    entry.offerSent = true; entry.creating = false
                    entry.local.forEach { signal("webrtc-ice-candidate", id, JSONObject().put("candidate", it)) }; entry.local.clear()
                }
            }
        } catch (_: Exception) { remove(id); report("Could not initialize listener peer.") }
    }
    fun receive(event: String, data: JSONObject) {
        val id = data.optString("sender"); val entry = peers[id] ?: return
        if (event == "webrtc-answer") {
            val answer = data.optJSONObject("answer") ?: return
            if (!entry.offerSent || entry.answered || entry.applying || answer.optString("type") != "answer" || answer.optString("sdp").isBlank()) return
            entry.applying = true
            entry.pc.setRemote(answer.getString("sdp")) { success ->
                if (peers[id] !== entry) return@setRemote
                entry.applying = false
                if (!success) { remove(id); report("Listener SDP answer rejected."); return@setRemote }
                entry.answered = true; entry.cancel?.invoke(); entry.cancel = null
                entry.remote.forEach { entry.pc.addIce(it) }; entry.remote.clear()
                if (entry.retry) { remove(id); offer(id) }
            }
        } else if (event == "webrtc-ice-candidate") {
            val candidate = data.optJSONObject("candidate") ?: return
            if (candidate.optString("candidate").isBlank()) return
            if (!entry.answered) { if (entry.remote.size < 256) entry.remote.add(candidate) }
            else entry.pc.addIce(candidate)
        }
    }
    fun retain(ids: Set<String>) { peers.keys.toList().filter { it !in ids }.forEach(::remove) }
    private fun remove(id: String) {
        val entry = peers.remove(id) ?: return
        entry.cancel?.invoke()
        try { entry.pc.close() } catch (_: UninitializedPropertyAccessException) { /* Factory failed before ownership transferred. */ }
    }
    fun close() = peers.keys.toList().forEach(::remove)
    fun count() = peers.size
}
