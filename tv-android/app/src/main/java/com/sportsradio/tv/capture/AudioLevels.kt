package com.sportsradio.tv.capture

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sqrt

data class AudioLevels(val rms: Double = 0.0, val peak: Double = 0.0) {
    val dbfs: Double? get() = if (rms > 0) 20 * log10(rms) else null
    companion object {
        fun measure(samples: ShortArray): AudioLevels {
            if (samples.isEmpty()) return AudioLevels()
            var sum = 0.0
            var peak = 0.0
            for (sample in samples) {
                val value = sample.toDouble() / 32768.0
                sum += value * value
                peak = maxOf(peak, abs(value))
            }
            return AudioLevels(sqrt(sum / samples.size), peak)
        }
    }
}
