package com.sportsradio.tv

import com.sportsradio.tv.capture.CaptureSnapshot

/** Process-local status only: no PCM persistence, broadcasts, credentials or exported IPC. */
object CaptureStatus {
    var snapshot = CaptureSnapshot(); private set
    fun publish(value: CaptureSnapshot) { snapshot = value }
}
