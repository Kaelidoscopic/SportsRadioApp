package com.sportsradio.tv.transport

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TransportTests {
    @Test fun partialPcmReframingPreservesNonzeroSamples() {
        val queue = PcmQueue(); queue.push(ShortArray(200) { 1000 }, 48000, 1)
        queue.push(ShortArray(280) { -1000 }, 48000, 1)
        val frame = queue.pull(); assertEquals(480, frame.size)
        assertEquals(1000.toShort(), frame[199]); assertEquals((-1000).toShort(), frame[200])
        assertTrue(queue.deliveredEnergy > 0); assertEquals(1L, queue.delivered)
    }
    @Test fun queueBoundsLatencyClearsAndNeverReplaysAfterClose() {
        val queue = PcmQueue()
        repeat(10) { queue.push(ShortArray(480) { it.toShort() }, 48000, 1) }
        assertEquals(5L, queue.dropped)
        repeat(5) { queue.pull() }; assertArrayEquals(ShortArray(480), queue.pull())
        queue.push(ShortArray(100) { 1 }, 48000, 1); queue.clear()
        queue.push(ShortArray(380) { 1 }, 48000, 1); assertArrayEquals(ShortArray(480), queue.pull())
        queue.close(); queue.push(ShortArray(480) { 1000 }, 48000, 1)
        assertArrayEquals(ShortArray(480), queue.pull())
    }
    @Test(expected = IllegalArgumentException::class) fun unsupportedPcmDoesNotSilentlyResample() {
        PcmQueue().push(ShortArray(480), 44100, 1)
    }
    private class Fake : PeerDriver {
        lateinit var offer: (String?) -> Unit
        lateinit var local: (Boolean) -> Unit
        lateinit var answer: (Boolean) -> Unit
        var closed = false; var remoteCalls = 0; val ice = mutableListOf<JSONObject>()
        override fun createOffer(done: (String?) -> Unit) { offer = done }
        override fun setLocal(sdp: String, done: (Boolean) -> Unit) { local = done }
        override fun setRemote(sdp: String, done: (Boolean) -> Unit) { remoteCalls++; answer = done }
        override fun addIce(candidate: JSONObject) { ice.add(candidate) }
        override fun close() { closed = true }
    }
    private class Fixture {
        val drivers = mutableListOf<Fake>(); val localIce = mutableListOf<(JSONObject) -> Unit>()
        val sent = mutableListOf<String>(); val timers = mutableListOf<() -> Unit>()
        val host = HostPeers({ _, ice, _ -> localIce.add(ice); Fake().also { drivers.add(it) } },
            { event, _, _ -> sent.add(event) }, object : Deadline {
                override fun after(ms: Long, action: () -> Unit): () -> Unit { timers.add(action); return {} }
            }, {})
        fun finish(index: Int = 0) { drivers[index].offer("audio-sdp"); drivers[index].local(true) }
        fun answer(id: String) = JSONObject().put("sender", id).put("answer", JSONObject().put("type", "answer").put("sdp", "answer-sdp"))
    }
    @Test fun offerPrecedesIceEarlyRemoteIceWaitsForAnswer() {
        val f = Fixture(); f.host.offer("a")
        f.localIce[0](JSONObject().put("candidate", "local")); assertTrue(f.sent.isEmpty())
        f.host.receive("webrtc-ice-candidate", JSONObject().put("sender", "a").put("candidate", JSONObject().put("candidate", "remote")))
        f.finish(); assertEquals(listOf("webrtc-offer", "webrtc-ice-candidate"), f.sent)
        assertTrue(f.drivers[0].ice.isEmpty())
        f.host.receive("webrtc-answer", f.answer("a")); f.drivers[0].answer(true)
        assertEquals(1, f.drivers[0].ice.size)
    }
    @Test fun multiListenerLeaveRejoinAndLateAnswerCannotTouchReplacement() {
        val f = Fixture(); f.host.offer("a"); f.host.offer("b"); f.finish(0); f.finish(1)
        f.host.receive("webrtc-answer", f.answer("a"))
        val stale = f.drivers[0].answer
        f.host.retain(setOf("b")); assertTrue(f.drivers[0].closed); assertFalse(f.drivers[1].closed)
        f.host.offer("a"); stale(true); assertEquals(2, f.host.count())
        f.host.close(); assertTrue(f.drivers.all { it.closed }); assertEquals(0, f.host.count())
    }
    @Test fun pendingRetryCoalescesAndTimeoutReleasesStuckPeer() {
        val f = Fixture(); f.host.offer("a"); f.host.offer("a", true)
        assertEquals(1, f.drivers.size); f.timers[0]()
        assertTrue(f.drivers[0].closed); assertEquals(2, f.drivers.size)
        f.drivers[0].offer("stale"); assertTrue(f.sent.isEmpty()); f.host.close()
    }
    @Test fun duplicateAndOutsiderAnswersAreIgnored() {
        val f = Fixture(); f.host.offer("a"); f.finish()
        f.host.receive("webrtc-answer", f.answer("outsider")); assertEquals(0, f.drivers[0].remoteCalls)
        f.host.receive("webrtc-answer", f.answer("a")); f.drivers[0].answer(true)
        f.host.receive("webrtc-answer", f.answer("a")); f.host.close()
    }
}
