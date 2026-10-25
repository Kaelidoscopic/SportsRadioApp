package com.sportsradio.tv

import com.sportsradio.tv.capture.*
import com.sportsradio.tv.transport.PcmQueue
import org.junit.Assert.*
import org.junit.Test

/** Real controller/PCM queue under a simulated service; Android policy needs device tests. */
class BackgroundPipelineTests {
    private class Service {
        var stopped = false; var now = 0L; var rooms = 0; var room = false
        lateinit var deliver: (PcmFrame) -> Unit
        val queue = PcmQueue()
        val metrics = CaptureDiagnostics { now }
        val capture = CaptureController({ now }, {})
        val ui = BroadcastActivityLifecycle({ if (!room) { room = true; rooms++ } }, {}, {}, {}, { stop() })
        init {
            metrics.start()
            capture.start(object : CaptureAdapter {
                override fun start(onFrame: (PcmFrame) -> Unit, onFailure: (String) -> Unit) { deliver = onFrame }
                override fun stop() { stopped = true }
            })
        }
        fun tick(): Double {
            now += 10
            val frame = PcmFrame(ShortArray(480) { 2000 }, 48000, 1, now * 1000000)
            if (!stopped) { metrics.frame(frame.samples); queue.push(frame.samples, 48000, 1) }
            deliver(frame)
            return AudioLevels.measure(queue.pull()).rms
        }
        fun stop() { capture.stop(); metrics.stop(false); queue.close() }
        fun revoke() { capture.stop(CaptureState.ERROR, "Projection revoked"); metrics.stop(true); queue.close() }
    }
    @Test fun pcmContinuesAcrossVisibleBackHomeAppsAndRecreation() {
        val s = Service(); s.ui.onStart(); assertTrue(s.tick() > 0)
        s.ui.onBack(); s.ui.onStop(); repeat(20) { assertTrue(s.tick() > 0) }
        s.ui.onStart(); assertTrue(s.tick() > 0)
        s.ui.onStop() // Home
        repeat(20) { assertTrue(s.tick() > 0) }
        s.ui.onStart(); s.ui.onStop(); s.ui.onDestroy() // Apps / recreation
        repeat(20) { assertTrue(s.tick() > 0) }
        s.ui.onStart(); assertTrue(s.tick() > 0)
        assertEquals(1, s.rooms); assertFalse(s.stopped)
        assertEquals(63L, s.metrics.snapshot().nonzero)
        assertTrue(s.queue.deliveredEnergy > 0)
    }
    @Test fun onlyExplicitStopEndsServiceOwnedPcm() {
        val s = Service(); s.ui.onStart(); s.ui.onStop(); assertTrue(s.tick() > 0)
        s.ui.stop(); assertEquals(0.0, s.tick(), 0.0)
        s.ui.onStart(); assertTrue(s.stopped); assertEquals(1, s.rooms)
        assertEquals(CaptureState.STOPPED, s.capture.snapshot.state)
    }
    @Test fun projectionRevocationStopsPcmAndRejectsLateFrames() {
        val s = Service(); s.ui.onStart(); s.ui.onStop(); assertTrue(s.tick() > 0)
        s.revoke(); assertEquals(0.0, s.tick(), 0.0)
        assertEquals(CaptureState.ERROR, s.capture.snapshot.state)
        assertEquals(1L, s.metrics.snapshot().interruptions)
        s.ui.onStart(); assertEquals(1, s.rooms); assertTrue(s.stopped)
    }
}
