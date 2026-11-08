package com.sportsradio.tv.device

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.sportsradio.tv.BroadcastRuntime
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors

/** Independent of capture, room ownership and Android projection consent. */
object DevicePairingRuntime {
    val PAIR_URL = com.sportsradio.tv.BuildConfig.LISTENER_URL + "/#devices"
    private val handler=Handler(Looper.getMainLooper())
    private val worker=Executors.newSingleThreadExecutor()
    private var repository: IdentityRepository?=null
    private var registered=false
    @Volatile var busy=false; private set
    @Volatile var snapshot=PairingSnapshot(); private set
    private val state=PairingState()
    private class ApiFailure(val code: Int, val reason: String): Exception()
    private val poll=object: Runnable {
        override fun run() { perform("status"); handler.postDelayed(this,15000) }
    }
    fun ensure(context: Context) {
        if(repository!=null) return
        repository=IdentityRepository(BroadcastRuntime.BACKEND,EncryptedIdentityStore(context.applicationContext))
        perform("status"); handler.postDelayed(poll,15000)
    }
    fun pair() = perform("pairing")
    fun rotate() = perform("rotate")
    fun replace() = perform("replace")
    fun current(): PairingSnapshot {
        val value=snapshot
        return if(value.status=="Waiting for Pairing" && System.currentTimeMillis()>=value.expiresAt) value.copy(status="Expired",code="") else value
    }
    private fun request(path: String, identity: DeviceIdentity, body: JSONObject=JSONObject(), key: String=identity.credential): JSONObject {
        val url=URI(identity.backend+"/api/devices"+path).toURL()
        require(url.protocol=="https")
        val connection=url.openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects=false; connection.requestMethod="POST"
            connection.connectTimeout=5000; connection.readTimeout=5000; connection.doOutput=true
            connection.setRequestProperty("Authorization","Bearer $key")
            connection.setRequestProperty("Content-Type","application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status=connection.responseCode
            val raw=(if(status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val result=try { JSONObject(raw.ifBlank { "{}" }) } catch(_: org.json.JSONException) {
                if(status in 200..299) throw com.sportsradio.tv.DeploymentFailure("RESPONSE") else JSONObject()
            }
            if(status !in 200..299) throw ApiFailure(status,result.optString("error"))
            return result
        } finally { connection.disconnect() }
    }
    private fun perform(action: String) {
        if(busy || repository==null) return
        busy=true
        worker.execute {
            try {
                val repo=requireNotNull(repository)
                var identity=if(action=="replace") {
                    val fresh=repo.replace(); registered=false
                    state.update("Unpaired",0); snapshot=state.value
                    fresh
                } else repo.get()
                com.sportsradio.tv.DeploymentGuard.verify()
                if(action=="rotate" && !registered && identity.pending==null) {
                    request("/register",identity,JSONObject().put("deviceId",identity.id).put("name","Android TV"))
                    registered=true
                }
                if(action=="rotate") identity=repo.stageRotation()
                if(identity.pending!=null) {
                    try { request("/${identity.id}/status",identity,key=requireNotNull(identity.pending)) }
                    catch(error: ApiFailure) {
                        if(error.code!=401) throw error
                        request("/${identity.id}/rotate",identity,JSONObject().put("credential",identity.pending))
                    }
                    identity=repo.promote(identity)
                }
                if(!registered) {
                    request("/register",identity,JSONObject().put("deviceId",identity.id).put("name","Android TV"))
                    registered=true
                }
                val response=request("/${identity.id}/"+if(action=="pairing") "pairing" else "status",identity)
                state.update(response.getString("status"),response.optLong("expiresAt",0),response.optString("code").takeIf { it.isNotEmpty() })
                snapshot=state.value
            } catch(error: ApiFailure) {
                val message=when(error.reason) {
                    "PAIRING_NOT_CONFIGURED" -> "Pairing is not enabled on this backend yet. Broadcasting is unaffected."
                    "RATE_LIMITED" -> "Too many attempts. Wait before retrying."
                    "INVALID_DEVICE_CREDENTIAL" -> "Authentication: device credential rejected. Retry or explicitly register a new identity."
                    "ALREADY_PAIRED" -> "Already paired; ownership was not changed."
                    else -> if(error.code==401 || error.code==403) "Authentication: device request rejected. Check credential or deployment access policy." else "Backend API rejected device request (HTTP ${error.code}). Check staging configuration and retry."
                }
                snapshot=snapshot.copy(message=message)
            } catch(error: Exception) { snapshot=snapshot.copy(message=com.sportsradio.tv.connectionFailureMessage(error)) }
            finally { busy=false }
        }
    }
}
