package com.sportsradio.tv

import com.sportsradio.tv.capture.*
import org.junit.Assert.*
import org.junit.Test

class BroadcastNavigationTests {
    private class Session {
        var rooms = 0; var roomReady = false; var backgrounds = 0; var ui = false
        var peers = true; var projection = true; var captureStops = 0
        val controller = CaptureController({ 0L }, {})
        val adapter = object : CaptureAdapter {
            override fun start(onFrame: (PcmFrame) -> Unit, onFailure: (String) -> Unit) {}
            override fun stop() { captureStops++ }
        }
        init { controller.start(adapter) }
        fun terminateService() { controller.stop(); peers = false; projection = false }
        val activity = BroadcastActivityLifecycle(
            { if (!roomReady) { rooms++; roomReady = true } }, { ui = true }, { ui = false },
            { backgrounds++ }, { terminateService() })
        fun assertLive() { assertEquals(0, captureStops); assertTrue(peers); assertTrue(projection); assertTrue(roomReady) }
    }
    @Test fun backBackgroundsWithoutDestroyingSession() {
        val s = Session(); s.activity.onStart(); s.activity.onBack(); s.activity.onStop()
        assertEquals(1, s.backgrounds); assertFalse(s.ui); s.assertLive()
        s.activity.onDestroy(); s.assertLive()
    }
    @Test fun homeOnlyPausesUi() {
        val s = Session(); s.activity.onStart(); s.activity.onStop()
        assertEquals(0, s.backgrounds); assertFalse(s.ui); s.assertLive()
    }
    @Test fun returningOrRecreatingActivityReusesRoomAndCapture() {
        val s = Session(); s.activity.onStart(); s.activity.onStop(); s.activity.onDestroy(); s.activity.onStart()
        assertEquals(1, s.rooms); assertTrue(s.ui); s.assertLive()
    }
    @Test fun explicitStopClosesMediaButRetainsRoom() {
        val s = Session(); s.activity.onStart(); s.activity.stop()
        assertEquals(1, s.captureStops); assertFalse(s.peers); assertFalse(s.projection); assertTrue(s.roomReady)
        s.activity.stop(); assertEquals(1, s.captureStops)
    }
    @Test fun genuineServiceTerminationStillReleasesCapture() {
        val s = Session(); s.activity.onStart(); s.activity.onBack(); s.terminateService()
        assertEquals(CaptureState.STOPPED, s.controller.snapshot.state)
        assertEquals(1, s.captureStops); assertFalse(s.projection); assertFalse(s.peers)
        s.activity.onStart(); assertEquals(1, s.captureStops)
    }
}
