package com.qltc.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only the native ingest worker can read the device credential. Never return it to WebView. */
internal class DeviceCredentialStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("qltc_device_credentials", Context.MODE_PRIVATE)
    private val legacyPrefs = context.applicationContext.getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)

    @Synchronized
    fun read(): String? {
        migrateLegacyCredential()
        val encrypted = prefs.getString("ciphertext", null) ?: return null
        val iv = prefs.getString("iv", null) ?: return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, decode(iv)))
            String(cipher.doFinal(decode(encrypted)), Charsets.UTF_8).takeIf { it.startsWith("qltc_dev_") }
        } catch (e: Exception) {
            Log.w("QLTC_Credential", "Stored device credential unavailable; pairing required")
            null
        }
    }

    @Synchronized
    fun save(token: String) {
        require(token.startsWith("qltc_dev_") && token.length >= 24) { "Invalid device credential" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        check(prefs.edit()
            .putString("iv", encode(cipher.iv))
            .putString("ciphertext", encode(ciphertext))
            .commit()) { "Device credential could not be persisted" }
        removeLegacyPlaintext()
    }

    @Synchronized
    fun clear() {
        prefs.edit().remove("iv").remove("ciphertext").commit()
        removeLegacyPlaintext()
    }

    private fun migrateLegacyCredential() {
        val legacyToken = legacyPrefs.getString("device_token", null)
        if (legacyToken != null && !prefs.contains("ciphertext") && legacyToken.startsWith("qltc_dev_")) {
            try {
                save(legacyToken)
            } catch (e: Exception) {
                Log.w("QLTC_Credential", "Legacy device credential migration failed; pairing required")
            }
        }
        // auth_token was an owner credential. It must never be used for notification ingest.
        removeLegacyPlaintext()
    }

    private fun removeLegacyPlaintext() {
        legacyPrefs.edit().remove("device_token").remove("auth_token").commit()
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun decode(value: String) = Base64.decode(value, Base64.NO_WRAP)

    companion object { private const val KEY_ALIAS = "qltc_notification_ingest_device_v2" }
}
