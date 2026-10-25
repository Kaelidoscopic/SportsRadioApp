package com.sportsradio.tv.room

import android.os.Handler
import io.socket.client.Ack
import io.socket.client.IO
import org.json.JSONObject

class SocketIoPort(url: String, private val main: Handler) : RoomSocket {
    private val socket = IO.socket(url, IO.Options.builder().setReconnection(true)
        .setReconnectionDelay(500).setReconnectionDelayMax(3000).setTimeout(8000).setForceNew(true).build())
    private var closed = false
    override val id: String? get() = socket.id()
    override val connected: Boolean get() = socket.connected()
    override fun on(event: String, callback: (JSONObject) -> Unit) {
        socket.on(event) { args -> main.post { if (!closed) callback(args.firstOrNull() as? JSONObject ?: JSONObject()) } }
    }
    override fun emit(event: String, payload: JSONObject) { if (!closed) socket.emit(event, payload) }
    override fun request(event: String, payload: JSONObject, callback: (JSONObject?) -> Unit) {
        var completed = false // Only accessed on main.
        val timeout = Runnable { if (!completed && !closed) { completed = true; callback(null) } }
        main.postDelayed(timeout, 5000)
        socket.emit(event, payload, Ack { args -> main.post {
            if (!completed && !closed) { completed = true; main.removeCallbacks(timeout); callback(args.firstOrNull() as? JSONObject) }
        } })
    }
    override fun connect() { if (!closed) socket.connect() }
    override fun close() { closed = true; socket.off(); socket.disconnect() }
}
