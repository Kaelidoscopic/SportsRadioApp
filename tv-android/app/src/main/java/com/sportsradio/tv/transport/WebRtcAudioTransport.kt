package com.sportsradio.tv.transport

import android.content.Context
import android.os.Handler
import org.json.JSONObject
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.concurrent.Executors

/** Owns one PCM-backed audio source shared by all native, send-only listener peers. */
class WebRtcAudioTransport(context: Context, private val main: Handler,
    signal: (String, String, JSONObject) -> Unit, private val report: (String) -> Unit,
    private val fatal: () -> Unit) {
    val pcm = PcmQueue()
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private lateinit var adm: JavaAudioDeviceModule
    private lateinit var factory: PeerConnectionFactory
    private lateinit var source: AudioSource
    private lateinit var track: AudioTrack
    private var disposed = false
    private val active = mutableSetOf<PeerConnection>()
    private val connectionStates = mutableMapOf<PeerConnection, String>()
    private val health = TransportDiagnostics()
    private var healthSummary = "Waiting for sender statistics"
    private val counters = mutableMapOf<PeerConnection, Pair<Long, Long>>()
    var bytesSent = 0L; private set
    var packetsSent = 0L; private set
    val nativeBlocks: Long get() = adm.audioInput.nativeBlocks
    val nativeEnergy: Double get() = adm.audioInput.nativeEnergy
    lateinit var peers: HostPeers; private set

    init {
      try {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(false).setInjectableLogger({ _, _, _ -> }, Logging.Severity.LS_NONE).createInitializationOptions())
        adm = JavaAudioDeviceModule.builder(context).setScheduler(scheduler)
            .setInputSampleRate(48000).setOutputSampleRate(48000).setUseStereoInput(false)
            .setUseHardwareAcousticEchoCanceler(false).setUseHardwareNoiseSuppressor(false).setEnableVolumeLogger(false)
            .setAudioRecordErrorCallback(object : JavaAudioDeviceModule.AudioRecordErrorCallback {
                private fun fail() { main.post { if (!disposed) { report("Playback PCM bridge failed. Stop and start broadcasting."); fatal() } } }
                override fun onWebRtcAudioRecordInitError(message: String) = fail()
                override fun onWebRtcAudioRecordStartError(code: JavaAudioDeviceModule.AudioRecordStartErrorCode, message: String) = fail()
                override fun onWebRtcAudioRecordError(message: String) = fail()
            }).createAudioDeviceModule()
        adm.audioInput.setPcmQueue(pcm)
        factory = PeerConnectionFactory.builder().setAudioDeviceModule(adm).createPeerConnectionFactory()
        source = factory.createAudioSource(MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("googHighpassFilter", "false"))
        })
        track = factory.createAudioTrack("sportsradio-playback", source)
        track.setEnabled(true)
        peers = HostPeers(::createPeer, signal, object : Deadline {
            override fun after(ms: Long, action: () -> Unit): () -> Unit {
                val task = Runnable(action); main.postDelayed(task, ms); return { main.removeCallbacks(task) }
            }
        }, report)
      } catch (error: Throwable) { close(); throw error }
    }
    private fun createPeer(id: String, ice: (JSONObject) -> Unit, state: (String) -> Unit): PeerDriver {
        val config = PeerConnection.RTCConfiguration(listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        var ownedPeer: PeerConnection? = null
        val pc = requireNotNull(factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) { main.post { if (!disposed) ice(JSONObject()
                .put("candidate", candidate.sdp).put("sdpMid", candidate.sdpMid).put("sdpMLineIndex", candidate.sdpMLineIndex)) } }
            override fun onConnectionChange(value: PeerConnection.PeerConnectionState) { main.post { if (!disposed) { ownedPeer?.takeIf { it in active }?.let { connectionStates[it] = value.name.lowercase(); state(value.name.lowercase()) } } } }
            override fun onIceConnectionChange(value: PeerConnection.IceConnectionState) { main.post { if (!disposed && value == PeerConnection.IceConnectionState.FAILED) state("failed") } }
            override fun onSignalingChange(value: PeerConnection.SignalingState) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(value: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(values: Array<out IceCandidate>) {}
            override fun onAddStream(stream: MediaStream) {}
            override fun onRemoveStream(stream: MediaStream) {}
            override fun onDataChannel(channel: DataChannel) { channel.close() }
            override fun onRenegotiationNeeded() {}
        }))
        ownedPeer = pc
        connectionStates[pc] = "new"
        pc.addTransceiver(track, RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_ONLY, listOf("sportsradio")))
        active.add(pc)
        return object : PeerDriver {
            private var closed = false
            private fun observer(created: ((String?) -> Unit)? = null, applied: ((Boolean) -> Unit)? = null) = object : SdpObserver {
                override fun onCreateSuccess(value: SessionDescription) { main.post { if (!closed && !disposed) created?.invoke(value.description) } }
                override fun onSetSuccess() { main.post { if (!closed && !disposed) applied?.invoke(true) } }
                override fun onCreateFailure(error: String) { main.post { if (!closed && !disposed) created?.invoke(null) } }
                override fun onSetFailure(error: String) { main.post { if (!closed && !disposed) applied?.invoke(false) } }
            }
            override fun createOffer(done: (String?) -> Unit) { pc.createOffer(observer(created = done), MediaConstraints()) }
            override fun setLocal(sdp: String, done: (Boolean) -> Unit) { pc.setLocalDescription(observer(applied = done), SessionDescription(SessionDescription.Type.OFFER, sdp)) }
            override fun setRemote(sdp: String, done: (Boolean) -> Unit) { pc.setRemoteDescription(observer(applied = done), SessionDescription(SessionDescription.Type.ANSWER, sdp)) }
            override fun addIce(candidate: JSONObject) {
                pc.addIceCandidate(IceCandidate(candidate.optString("sdpMid", "0"), candidate.optInt("sdpMLineIndex", 0), candidate.getString("candidate")), object : AddIceObserver {
                    override fun onAddSuccess() {}
                    override fun onAddFailure(error: String) { main.post { if (!disposed && !closed) report("Listener ICE candidate could not be applied.") } }
                })
            }
            override fun close() {
                if (closed) return
                closed = true; active.remove(pc); counters.remove(pc); connectionStates.remove(pc)
                bytesSent = counters.values.sumOf { it.first }; packetsSent = counters.values.sumOf { it.second }
                pc.close(); pc.dispose()
            }
        }
    }
    fun diagnosticSummary(): String = healthSummary
    fun sample() {
        healthSummary = health.sample(packetsSent, bytesSent, nativeBlocks, nativeEnergy, active.size,
            connectionStates.values.count { it == "connected" }, connectionStates.values.count { it == "failed" })
        active.toList().forEach { pc -> pc.getStats { stats ->
            var bytes = 0L; var packets = 0L
            stats.statsMap.values.filter { it.type == "outbound-rtp" && (it.members["kind"] ?: it.members["mediaType"]) == "audio" }.forEach {
                bytes += (it.members["bytesSent"] as? Number)?.toLong() ?: 0
                packets += (it.members["packetsSent"] as? Number)?.toLong() ?: 0
            }
            main.post { if (!disposed && pc in active) {
                counters[pc] = bytes to packets; bytesSent = counters.values.sumOf { it.first }; packetsSent = counters.values.sumOf { it.second }
            } }
        } }
    }
    fun close() {
        if (disposed) return
        disposed = true
        if (::peers.isInitialized) peers.close()
        pcm.close()
        try {
            if (::track.isInitialized) track.dispose()
            if (::source.isInitialized) source.dispose()
            if (::factory.isInitialized) factory.dispose()
        } finally {
            if (::adm.isInitialized) adm.release()
            scheduler.shutdownNow()
        }
    }
}
