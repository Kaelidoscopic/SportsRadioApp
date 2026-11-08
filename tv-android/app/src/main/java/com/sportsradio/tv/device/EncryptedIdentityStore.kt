package com.sportsradio.tv.device

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class EncryptedIdentityStore(context: Context) : IdentityStore {
    private val file = AtomicFile(File(context.noBackupFilesDir, "device.aesgcm"))
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    override fun load(): DeviceIdentity? {
        if (!file.baseFile.exists()) return null
        val data = file.readFully(); require(data.size >= 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
        val json = JSONObject(String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8))
        return DeviceIdentity(json.getString("backend"), json.getString("id"), json.getString("credential"), json.optString("pending").takeIf { it.isNotEmpty() })
    }
    override fun save(record: DeviceIdentity) {
        val json = JSONObject().put("backend", record.backend).put("id", record.id)
            .put("credential", record.credential).put("pending", record.pending ?: "")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
        require(cipher.iv.size == 12)
        val out = file.startWrite()
        try { out.write(cipher.iv + cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))); file.finishWrite(out) }
        catch (error: Exception) { file.failWrite(out); throw error }
    }
    companion object { private const val ALIAS = "sportsradio.device.identity.v1" }
}
