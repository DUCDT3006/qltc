package com.qltc.app

import android.content.Context
import android.net.Uri

/** Resolves the one API origin used by native pairing and outbox requests. */
internal object BackendApiConfig {
    private const val TRUSTED_BACKEND_HOST = "qltc-backend.dtd-store.workers.dev"
    private const val DEFAULT_API_BASE = "https://$TRUSTED_BACKEND_HOST/api"

    fun apiBaseUrl(context: Context): String {
        val configured = context.applicationContext
            .getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)
            .getString("backend_url", null)
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: return DEFAULT_API_BASE

        return try {
            val uri = Uri.parse(configured)
            val path = uri.path.orEmpty().trimEnd('/')
            val valid = uri.scheme.equals("https", ignoreCase = true) &&
                uri.host?.equals(TRUSTED_BACKEND_HOST, ignoreCase = true) == true &&
                uri.userInfo == null &&
                (uri.port == -1 || uri.port == 443) &&
                uri.query == null && uri.fragment == null &&
                (path.isEmpty() || path == "/api")
            if (!valid) return DEFAULT_API_BASE

            DEFAULT_API_BASE
        } catch (_: Exception) {
            DEFAULT_API_BASE
        }
    }

    fun endpoint(context: Context, path: String): String {
        val suffix = path.trimStart('/')
        require(suffix.isNotBlank()) { "API endpoint path is required" }
        return "${apiBaseUrl(context)}/$suffix"
    }
}
