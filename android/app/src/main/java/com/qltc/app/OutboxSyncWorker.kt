package com.qltc.app

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkerParameters
import androidx.work.WorkManager
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlin.math.max

internal object OutboxSyncScheduler {
    private const val WAKE_WORK = "qltc_notification_outbox_wake"
    private const val RETRY_WORK = "qltc_notification_outbox_retry"
    private const val PERIODIC_WORK = "qltc_notification_outbox_recovery"
    private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun ensurePeriodic(context: Context) {
        try {
            val request = PeriodicWorkRequestBuilder<OutboxSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, request
            )
        } catch (t: Throwable) {
            Log.e("QLTC_Sync", "WorkManager ensurePeriodic warning", t)
        }
    }

    fun scheduleNow(context: Context) {
        try {
            val request = OneTimeWorkRequestBuilder<OutboxSyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                WAKE_WORK, ExistingWorkPolicy.REPLACE, request
            )
        } catch (t: Throwable) {
            Log.e("QLTC_Sync", "WorkManager scheduleNow warning", t)
        }
    }

    fun scheduleNext(context: Context, db: NotificationOutboxDb) {
        try {
            val nextAt = db.nextPendingAt()
            val manager = WorkManager.getInstance(context)
            if (nextAt == null) {
                manager.cancelUniqueWork(RETRY_WORK)
                return
            }
            val delay = max(0L, nextAt - System.currentTimeMillis())
            val request = OneTimeWorkRequestBuilder<OutboxSyncWorker>()
                .setConstraints(constraints)
                .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            manager.enqueueUniqueWork(RETRY_WORK, ExistingWorkPolicy.REPLACE, request)
        } catch (t: Throwable) {
            Log.e("QLTC_Sync", "WorkManager scheduleNext warning", t)
        }
    }
}

class OutboxSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = synchronized(SYNC_LOCK) {
        val db = NotificationOutboxDb(applicationContext)
        val prefs = applicationContext.getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)
        try {
            var processed = 0
            while (processed < 100 && !isStopped) {
                val dueItems = db.getDueItems(System.currentTimeMillis(), 25)
                if (dueItems.isEmpty()) break
                val credentials = DeviceCredentialStore(applicationContext)
                val token = credentials.read()
                if (token.isNullOrBlank()) {
                    db.pausePendingForAuth("DEVICE_PAIRING_REQUIRED")
                    prefs.edit().putString("last_ingest_error", "DEVICE_PAIRING_REQUIRED").apply()
                    break
                }
                var authFailed = false
                for (item in dueItems) {
                    if (isStopped) break
                    val result = sendItem(item, token)
                    when (result.outcome) {
                        SendOutcome.ACKED -> {
                            db.markAckedAndDelete(item.eventId)
                            prefs.edit().putLong("last_ingest_success_at", System.currentTimeMillis())
                                .remove("last_ingest_error").apply()
                        }
                        SendOutcome.AUTH_ERROR -> {
                            credentials.clear()
                            db.pausePendingForAuth(result.message)
                            prefs.edit().putString("last_ingest_error", "AUTH_PAUSED: ${result.message}").apply()
                            authFailed = true
                            break
                        }
                        SendOutcome.VALIDATION_ERROR -> {
                            db.markStatus(item.eventId, "failed_validation", result.message)
                            prefs.edit().putString("last_ingest_error", result.message).apply()
                        }
                        SendOutcome.RETRYABLE_ERROR -> {
                            db.markRetry(item.eventId, item.retryCount, result.message, result.retryAfterMs)
                            prefs.edit().putString("last_ingest_error", result.message).apply()
                        }
                    }
                    processed++
                }
                if (authFailed) break
            }
            OutboxSyncScheduler.scheduleNext(applicationContext, db)
            Result.success()
        } catch (e: Exception) {
            Log.e("QLTC_Sync", "Outbox sync failed; WorkManager will retry", e)
            Result.retry()
        } finally {
            db.close()
        }
    }

    private enum class SendOutcome { ACKED, AUTH_ERROR, VALIDATION_ERROR, RETRYABLE_ERROR }
    private data class SendResult(
        val outcome: SendOutcome,
        val message: String,
        val retryAfterMs: Long? = null
    )

    private fun sendItem(item: OutboxItem, deviceToken: String): SendResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(BackendApiConfig.endpoint(applicationContext, "notifications/ingest")).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                // The backend also deduplicates eventId in the payload; this header makes
                // transport-level retries explicit and safe for idempotent ingest handling.
                setRequestProperty("Idempotency-Key", item.eventId)
                setRequestProperty("Authorization", "Bearer $deviceToken")
                setRequestProperty("X-Device-Token", deviceToken)
                connectTimeout = 10000
                readTimeout = 10000
                doOutput = true
            }
            val payload = JSONObject().apply {
                put("eventId", item.eventId)
                put("packageName", item.packageName)
                put("title", item.title)
                put("text", item.text)
                put("occurredAt", item.occurredAt)
            }
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(payload.toString()) }
            val status = conn.responseCode
            when {
                status in 200..299 -> SendResult(SendOutcome.ACKED, "HTTP $status")
                status == 401 || status == 403 -> SendResult(SendOutcome.AUTH_ERROR, "HTTP $status")
                status == 400 -> SendResult(SendOutcome.VALIDATION_ERROR, "HTTP 400")
                else -> SendResult(
                    SendOutcome.RETRYABLE_ERROR, "HTTP $status",
                    if (status == 429 || status == 503) parseRetryAfter(conn.getHeaderField("Retry-After")) else null
                )
            }
        } catch (e: Exception) {
            SendResult(SendOutcome.RETRYABLE_ERROR, e.javaClass.simpleName)
        } finally {
            conn?.disconnect()
        }
    }

    private fun parseRetryAfter(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        value.trim().toLongOrNull()?.let { return it.coerceIn(0L, 86_400L) * 1000L }
        return try {
            val parsed = java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", java.util.Locale.US)
                .apply { timeZone = java.util.TimeZone.getTimeZone("GMT") }
                .parse(value)?.time ?: return null
            (parsed - System.currentTimeMillis()).coerceIn(0L, 86_400_000L)
        } catch (_: Exception) { null }
    }

    companion object {
        private val SYNC_LOCK = Any()
    }
}
