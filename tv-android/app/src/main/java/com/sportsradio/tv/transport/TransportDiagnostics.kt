package com.sportsradio.tv.transport

/** Counters are cumulative per transport. Never infer audibility from packet delivery. */
class TransportDiagnostics {
    private var previousPackets = 0L
    private var previousBytes = 0L
    private var previousBlocks = 0L
    private var previousEnergy = 0.0
    fun sample(packets: Long, bytes: Long, blocks: Long, energy: Double, listeners: Int,
        connected: Int, failed: Int): String {
        val packetDelta = (packets - previousPackets).coerceAtLeast(0)
        val byteDelta = (bytes - previousBytes).coerceAtLeast(0)
        val blockDelta = (blocks - previousBlocks).coerceAtLeast(0)
        val energyDelta = (energy - previousEnergy).coerceAtLeast(0.0)
        previousPackets = packets; previousBytes = bytes; previousBlocks = blocks; previousEnergy = energy
        val status = when {
            listeners == 0 -> "No listener peers"
            failed > 0 -> "Network/WebRTC failure: failed peer"
            connected == 0 -> "Network/WebRTC pending: no connected peer"
            blockDelta == 0L -> "Audio sender stalled: no native input callbacks"
            packetDelta == 0L -> "Network/WebRTC warning: no outgoing RTP progress"
            energyDelta <= 0 -> "Sending silent PCM; check capture source"
            else -> "Sending nonzero PCM and RTP; phone audibility must be checked separately"
        }
        return "$status; intervalPackets=$packetDelta intervalBytes=$byteDelta nativeBlocks=$blockDelta nativeEnergy=$energyDelta connectedPeers=$connected failedPeers=$failed"
    }
}
