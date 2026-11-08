package com.sportsradio.tv.device

import java.security.SecureRandom
import java.util.UUID

data class DeviceIdentity(val backend: String, val id: String, val credential: String, val pending: String? = null) {
    override fun toString() = "DeviceIdentity(credentials=[redacted])"
}
interface IdentityStore { fun load(): DeviceIdentity?; fun save(identity: DeviceIdentity) }
class IdentityRepository(private val backend: String, private val store: IdentityStore) {
    fun get(): DeviceIdentity {
        val old = try { store.load() } catch(error: Exception) { throw com.sportsradio.tv.SavedIdentityFailure("Saved identity cannot be decrypted/read. Retry or explicitly register a new identity in this test app.", error) }
        if (old != null) { if(old.backend != backend) throw com.sportsradio.tv.SavedIdentityFailure("Saved identity belongs to another backend. Explicitly register a new staging identity; existing ownership is not transferred."); return old }
        return replace()
    }
    private fun persist(identity: DeviceIdentity) {
        try { store.save(identity) } catch(error: Exception) { throw com.sportsradio.tv.SavedIdentityFailure("Saved identity could not be stored securely. No temporary credentials were substituted. Check device storage.", error) }
    }
    fun replace(): DeviceIdentity = DeviceIdentity(backend, UUID.randomUUID().toString(), secret()).also(::persist)
    fun stageRotation(): DeviceIdentity { val old=get(); return if(old.pending!=null) old else old.copy(pending=secret()).also(::persist) }
    fun promote(value: DeviceIdentity): DeviceIdentity = value.copy(credential=requireNotNull(value.pending),pending=null).also(::persist)
    private fun secret(): String = ByteArray(32).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
}
data class PairingSnapshot(val status: String = "Unpaired", val code: String = "", val expiresAt: Long = 0, val message: String = "Open pairing to register this TV.") {
    override fun toString() = "PairingSnapshot(status=$status, code=[redacted])"
}
class PairingState {
    var value = PairingSnapshot(); private set
    fun update(status: String, expires: Long, code: String? = null) {
        require(status in setOf("Unpaired","Waiting for Pairing","Paired","Expired"))
        value = PairingSnapshot(status, if(status=="Waiting for Pairing") code ?: value.code.takeIf { value.expiresAt==expires }.orEmpty() else "", expires, "")
    }
    fun view(now: Long): PairingSnapshot = if(value.status=="Waiting for Pairing" && now>=value.expiresAt) value.copy(status="Expired",code="") else value
}
