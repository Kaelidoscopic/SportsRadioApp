package com.sportsradio.tv.capture

import org.junit.Assert.*
import org.junit.Test

class CaptureTests {
    private class Fake : CaptureAdapter {
        var stops = 0
        lateinit var frame: (PcmFrame) -> Unit
        lateinit var failure: (String) -> Unit
        override fun start(onFrame: (PcmFrame) -> Unit, onFailure: (String) -> Unit) { frame = onFrame; failure = onFailure }
        override fun stop() { stops++ }
        fun samples(value: Short) = frame(PcmFrame(ShortArray(480) { value }, 48000, 1, 0))
    }
    @Test fun pcmSilenceFullScaleAndSignedMinimum() {
        assertEquals(AudioLevels(), AudioLevels.measure(shortArrayOf()))
        assertNull(AudioLevels.measure(ShortArray(480)).dbfs)
        val full = AudioLevels.measure(shortArrayOf(Short.MIN_VALUE, Short.MAX_VALUE))
        assertEquals(1.0, full.peak, 0.0); assertTrue(full.rms > 0.9999)
        assertEquals(-6.0206, AudioLevels.measure(shortArrayOf(16384, -16384)).dbfs!!, 0.001)
    }
    @Test fun silenceWarningAndSignalRecovery() {
        var now = 0L; val source = Fake(); val controller = CaptureController({ now }, {})
        controller.start(source); assertEquals(CaptureState.STARTING, controller.snapshot.state)
        source.samples(0); assertEquals(CaptureState.CAPTURING, controller.snapshot.state)
        now = 5001; source.samples(0); assertEquals(CaptureState.SILENT, controller.snapshot.state)
        source.samples(1000); assertEquals(CaptureState.CAPTURING, controller.snapshot.state)
        assertTrue(controller.snapshot.levels.rms > 0)
    }
    @Test fun stopRestartRejectsLateFramesAndErrors() {
        val controller = CaptureController({ 0 }, {}); val first = Fake(); val second = Fake()
        controller.start(first); first.samples(1000); controller.stop(); controller.stop()
        assertEquals(1, first.stops); assertEquals(AudioLevels(), controller.snapshot.levels)
        controller.start(second); first.samples(2000); first.failure("late")
        assertEquals(CaptureState.STARTING, controller.snapshot.state)
        second.samples(3000); assertEquals(1L, controller.snapshot.frames)
        second.failure("revoked"); assertEquals(CaptureState.ERROR, controller.snapshot.state)
        assertEquals(1, second.stops); assertEquals("revoked", controller.snapshot.message)
    }
    @Test fun duplicateStartDisposesUnusedAdapter() {
        val controller = CaptureController({ 0 }, {}); val first = Fake(); val unused = Fake()
        controller.start(first); controller.start(unused)
        controller.start(first); assertEquals(0, first.stops)
        assertEquals(1, unused.stops); first.samples(1000)
        assertEquals(CaptureState.CAPTURING, controller.snapshot.state); controller.stop()
    }
    @Test fun initializationFailureStopsResources() {
        var stopped = false; val controller = CaptureController({ 0 }, {})
        controller.start(object : CaptureAdapter {
            override fun start(onFrame: (PcmFrame) -> Unit, onFailure: (String) -> Unit) { error("denied") }
            override fun stop() { stopped = true }
        })
        assertTrue(stopped); assertEquals(CaptureState.ERROR, controller.snapshot.state)
        assertEquals("denied", controller.snapshot.message)
    }
}
