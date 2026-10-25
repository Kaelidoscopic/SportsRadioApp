package com.sportsradio.tv.room

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RoomTests {
    private class Socket : RoomSocket {
        override val id = "host"
        override var connected = false
        val handlers = mutableMapOf<String, (JSONObject) -> Unit>()
        val sent = mutableListOf<Pair<String, JSONObject>>()
        lateinit var reply: (JSONObject?) -> Unit
        override fun on(event: String, callback: (JSONObject) -> Unit) { handlers[event] = callback }
        override fun emit(event: String, payload: JSONObject) { sent.add(event to payload) }
        override fun request(event: String, payload: JSONObject, callback: (JSONObject?) -> Unit) { emit(event, payload); reply = callback }
        override fun connect() { connected = true; handlers["connect"]!!(JSONObject()) }
        override fun close() { connected = false }
        fun fire(event: String, value: JSONObject = JSONObject()) { if (event == "disconnect") connected = false; handlers[event]!!(value) }
    }
    private class Store : OwnershipStore {
        var record: Ownership? = null; var fail = false
        override fun load() = record
        override fun save(record: Ownership) { check(!fail); this.record = record }
        override fun clear() { record = null }
    }
    private class Fixture {
        val socket = Socket(); val store = Store(); val signals = mutableListOf<String>()
        val room = RoomSession(socket, store, "https://backend.example", {}, { event, _ -> signals.add(event) })
        fun registered() {
            room.connect(); room.register("TV"); socket.reply(result())
        }
        fun result() = JSONObject().put("ok", true).put("roomId", "TV123").put("roomName", "TV")
            .put("credential", "a".repeat(64)).put("expiresAt", Long.MAX_VALUE).put("members", JSONArray(listOf("host", "phone")))
    }
    @Test fun registrationStoresSecretButPublicStateDoesNotExposeIt() {
        val f = Fixture(); f.registered()
        assertTrue(f.room.state.ready); assertEquals(setOf("phone"), f.room.state.members)
        assertNotNull(f.store.record); assertFalse(f.store.record.toString().contains("a".repeat(64)))
        assertFalse(f.room.state.toString().contains("a".repeat(64)))
    }
    @Test fun disconnectRecoversWithCredentialAndNeverAutomaticallyRegistersOnDenial() {
        val f = Fixture(); f.registered(); f.room.broadcast(true); f.socket.fire("disconnect")
        assertFalse(f.room.state.ready); assertFalse(f.room.state.broadcasting)
        f.socket.connect(); assertEquals("desktop:recover", f.socket.sent.last().first)
        assertEquals("a".repeat(64), f.socket.sent.last().second.getString("credential"))
        f.socket.reply(JSONObject().put("ok", false).put("error", "RECOVERY_DENIED"))
        assertFalse(f.room.state.ready); assertEquals("desktop:recover", f.socket.sent.last().first)
    }
    @Test fun validRecoveryRetainsCodeAndNeedsExplicitBroadcastRestart() {
        val f = Fixture(); f.registered(); f.socket.fire("disconnect"); f.socket.connect(); f.socket.reply(f.result())
        assertTrue(f.room.state.ready); assertEquals("TV123", f.room.state.code); assertFalse(f.room.state.broadcasting)
    }
    @Test fun unauthorizedSignalingAndMembershipAreFiltered() {
        val f = Fixture(); f.registered()
        f.socket.fire("webrtc-answer", JSONObject().put("sender", "outsider")); assertTrue(f.signals.isEmpty())
        f.socket.fire("webrtc-answer", JSONObject().put("sender", "phone")); assertEquals(1, f.signals.size)
        val count = f.socket.sent.size
        f.room.send("webrtc-offer", "phone", JSONObject()); assertEquals(count, f.socket.sent.size)
        f.room.broadcast(true); val active = f.socket.sent.size
        f.room.send("webrtc-answer", "phone", JSONObject()); f.room.send("webrtc-offer", "outsider", JSONObject())
        assertEquals(active, f.socket.sent.size)
        f.room.send("webrtc-offer", "phone", JSONObject()); assertEquals(active + 1, f.socket.sent.size)
    }
    @Test fun interruptedRequestsAndTimeoutCannotAcceptLateOwnership() {
        val f = Fixture(); f.room.connect(); f.room.register("TV"); val late = f.socket.reply
        f.socket.fire("disconnect"); late(f.result()); assertFalse(f.room.state.ready); assertNull(f.store.record)
        f.socket.connect(); f.room.register("TV"); val timed = f.socket.reply
        timed(null); timed(f.result()); assertFalse(f.room.state.ready); assertFalse(f.room.state.connected)
    }
    @Test fun persistenceFailureClosesNewRoomAndExplicitEndClearsOwnership() {
        val f = Fixture(); f.store.fail = true; f.registered()
        assertFalse(f.room.state.ready); assertEquals("end-room", f.socket.sent.last().first)
        f.store.fail = false; f.room.register("TV"); f.socket.reply(f.result()); f.room.end()
        assertNull(f.store.record); assertFalse(f.room.state.ready)
    }
    @Test fun boundedRecoveryRetriesSameCredentialAndNeverRegisters() {
        val socket = Socket(); val store = Store(); var now = 100L
        val timers = mutableListOf<() -> Unit>()
        store.record = Ownership("https://backend.example", "TV123", "TV", "b".repeat(64), Long.MAX_VALUE)
        val room = RoomSession(socket, store, "https://backend.example", {}, { _, _ -> }, RecoveryScheduler { _, task ->
            timers.add(task); {}
        }, { now })
        room.connect(); socket.reply(JSONObject().put("ok", false).put("error", "RECOVERY_DENIED"))
        assertEquals(1, timers.size); timers[0]()
        assertTrue(socket.sent.all { it.first == "desktop:recover" })
        assertEquals("b".repeat(64), socket.sent.last().second.getString("credential"))
        socket.reply(JSONObject().put("ok", false).put("error", "RECOVERY_DENIED"))
        now = 60101; timers[1]()
        assertEquals(2, socket.sent.size); assertFalse(room.state.ready)
        assertTrue(room.state.message.contains("window ended"))
    }
    @Test fun shutdownCancelsFurtherRecovery() {
        val socket = Socket(); val store = Store(); val tasks = mutableListOf<() -> Unit>(); var cancelled = 0
        store.record = Ownership("https://backend.example", "TV123", "TV", "b".repeat(64), Long.MAX_VALUE)
        val room = RoomSession(socket, store, "https://backend.example", {}, { _, _ -> }, RecoveryScheduler { _, task ->
            tasks.add(task); { cancelled++ }
        }, { 100 })
        room.connect(); socket.reply(JSONObject().put("ok", false).put("error", "RECOVERY_DENIED"))
        room.close(); tasks[0]()
        assertEquals(1, cancelled); assertEquals(1, socket.sent.size)
    }
}
