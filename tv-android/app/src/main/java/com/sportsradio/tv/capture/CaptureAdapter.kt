package com.sportsradio.tv.capture

/** A capture source, independent of UI, rooms and any future network transport. */
interface CaptureAdapter {
    fun start(onFrame: (PcmFrame) -> Unit, onFailure: (String) -> Unit)
    /** Idempotent; returns only after the source has stopped delivering frames. */
    fun stop()
}

/** Owned copy; future consumers must not build an unbounded queue of frames. */
data class PcmFrame(val samples: ShortArray, val sampleRate: Int, val channels: Int, val timeNanos: Long)
