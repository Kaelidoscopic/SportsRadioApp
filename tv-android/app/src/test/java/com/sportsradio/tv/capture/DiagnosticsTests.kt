package com.sportsradio.tv.capture

import org.junit.Assert.*
import org.junit.Test
import com.sportsradio.tv.transport.TransportDiagnostics

class DiagnosticsTests {
    @Test fun rollingWindowCountsEveryCallbackAndExpiresSignal() {
        var now = 0L; val d = CaptureDiagnostics { now }; d.start()
        repeat(100) { d.frame(shortArrayOf(32767, -32768)) }
        d.frame(ShortArray(480))
        val s = d.snapshot()
        assertEquals(101L, s.windows); assertEquals(100L, s.nonzero)
        assertEquals(101, s.rollingWindows); assertEquals(100, s.rollingNonzero)
        assertEquals(1.0, s.peak, 0.0)
        assertTrue(s.rms > 0); assertTrue(s.status.startsWith("Capturing audio"))
        now = 5000; d.frame(ShortArray(480))
        assertEquals(1, d.snapshot().rollingWindows)
        assertEquals(0.0, d.snapshot().rms, 0.0)
        assertEquals(5000L, d.snapshot().sinceSignalMs)
        assertTrue(d.snapshot().status.startsWith("Capturing silence"))
    }
    @Test fun noFramesIsInterruptionNotSilenceAndStopIsIdempotent() {
        var now = 0L; val d = CaptureDiagnostics { now }; d.start(); d.start()
        now = 5000
        assertTrue(d.snapshot().status.contains("no PCM buffers"))
        d.stop(true); d.stop(true); d.frame(shortArrayOf(1000))
        assertEquals(1L, d.snapshot().interruptions); assertEquals(0L, d.snapshot().windows)
        assertEquals("Capture interrupted", d.snapshot().status)
        d.start(); d.frame(shortArrayOf(1000)); d.stop(false)
        assertEquals(1L, d.snapshot().restarts); assertEquals(1L, d.snapshot().interruptions)
        assertEquals(1L, d.snapshot().windows); assertEquals("Capture stopped", d.snapshot().status)
    }
    @Test fun thresholdAndWeightedRmsDoNotTreatTinyNoiseAsSignal() {
        val d = CaptureDiagnostics { 0 }; d.start()
        d.frame(shortArrayOf(1)); assertEquals(0L, d.snapshot().nonzero)
        d.frame(shortArrayOf(16384, -16384))
        assertEquals(1L, d.snapshot().nonzero)
        assertEquals(kotlin.math.sqrt((0.5 + 1.0 / (32768.0 * 32768)) / 3), d.snapshot().rms, 1e-9)
    }
    @Test fun transportSeparatesPendingStallSilenceAndProgress() {
        val d = TransportDiagnostics()
        assertTrue(d.sample(0,0,0,0.0,0,0,0).startsWith("No listener"))
        assertTrue(d.sample(0,0,0,0.0,1,0,0).contains("pending"))
        assertTrue(d.sample(0,0,0,0.0,1,0,1).contains("failure"))
        assertTrue(d.sample(0,0,0,0.0,1,1,0).contains("stalled"))
        assertTrue(d.sample(0,0,1,0.0,1,1,0).contains("no outgoing RTP"))
        assertTrue(d.sample(1,20,2,0.0,1,1,0).contains("silent PCM"))
        assertTrue(d.sample(2,40,3,0.1,1,1,0).contains("nonzero PCM"))
        assertFalse(d.sample(0,0,0,0.0,0,0,0).contains("=-"))
    }
}
