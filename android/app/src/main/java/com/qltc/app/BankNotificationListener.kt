package com.qltc.app

import android.app.Notification
import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import kotlin.math.min

private fun redactOtp(input: String): String = input.replace(
    Regex("(?i)(OTP|mã xác thực|ma xac thuc|code|passcode)([^0-9]{0,15})(\\d{4,8})"),
    "$1$2[REDACTED]"
)

private fun computeDeterministicEventId(
    pkg: String, notiId: Int, postTime: Long, title: String, body: String
): String {
    val raw = "$pkg|$notiId|$postTime|$title|$body"
    val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
    val hex = digest.take(12).joinToString("") { "%02x".format(it) }
    return "evt_$hex"
}

/**
 * Persistent SQLite Outbox for Bank Notifications (V2-06).
 * Guarantees every bank notification is durably persisted to disk BEFORE network transmission,
 * survives process death / reboot, migrates legacy SharedPreferences queue once,
 * and distinguishes retryable (429/5xx/network) vs auth-paused (401/403) vs permanent (400) errors.
 */
class NotificationOutboxDb(context: Context) :
    SQLiteOpenHelper(context, "qltc_notification_outbox.db", null, 2) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS notification_outbox (
                event_id TEXT PRIMARY KEY,
                package_name TEXT NOT NULL,
                title TEXT NOT NULL,
                text TEXT NOT NULL,
                occurred_at INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                retry_count INTEGER NOT NULL DEFAULT 0,
                next_retry_at INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON notification_outbox(status, next_retry_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        onCreate(db)
    }

    @Synchronized
    fun enqueue(
        eventId: String,
        packageName: String,
        title: String,
        text: String,
        occurredAt: Long
    ): Boolean {
        val db = writableDatabase
        val values = ContentValues().apply {
            put("event_id", eventId)
            put("package_name", packageName)
            put("title", title)
            put("text", text)
            put("occurred_at", occurredAt)
            put("status", "queued")
            put("retry_count", 0)
            put("next_retry_at", 0L)
            put("created_at", System.currentTimeMillis())
        }
        val rowId = db.insertWithOnConflict(
            "notification_outbox",
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE
        )
        return rowId != -1L
    }

    @Synchronized
    fun getDueItems(nowMs: Long, limit: Int = 25): List<OutboxItem> {
        val db = readableDatabase
        val list = mutableListOf<OutboxItem>()
        val cursor = db.query(
            "notification_outbox",
            arrayOf("event_id", "package_name", "title", "text", "occurred_at", "status", "retry_count"),
            "status IN ('queued', 'retry_scheduled') AND next_retry_at <= ?",
            arrayOf(nowMs.toString()),
            null,
            null,
            "occurred_at ASC",
            limit.toString()
        )
        cursor.use { c ->
            while (c.moveToNext()) {
                list.add(
                    OutboxItem(
                        eventId = c.getString(0),
                        packageName = c.getString(1),
                        title = c.getString(2),
                        text = c.getString(3),
                        occurredAt = c.getLong(4),
                        status = c.getString(5),
                        retryCount = c.getInt(6)
                    )
                )
            }
        }
        return list
    }

    @Synchronized
    fun markAckedAndDelete(eventId: String) {
        writableDatabase.delete("notification_outbox", "event_id = ?", arrayOf(eventId))
    }

    @Synchronized
    fun markRetry(eventId: String, currentRetryCount: Int, errorMsg: String, retryAfterMs: Long? = null) {
        val nextCount = currentRetryCount + 1
        // Exponential backoff: 5s, 15s, 45s, 120s, max 15m + jitter
        val baseDelaySec = min(900L, 5L * (1L shl min(nextCount, 8)))
        val jitterMs = (Math.random() * 2000).toLong()
        val delayMs = maxOf(baseDelaySec * 1000L + jitterMs, retryAfterMs ?: 0L)
        val nextRetryAt = System.currentTimeMillis() + delayMs

        val values = ContentValues().apply {
            put("status", "retry_scheduled")
            put("retry_count", nextCount)
            put("next_retry_at", nextRetryAt)
            put("last_error", errorMsg.take(200))
        }
        writableDatabase.update("notification_outbox", values, "event_id = ?", arrayOf(eventId))
    }

    @Synchronized
    fun markStatus(eventId: String, status: String, errorMsg: String) {
        val values = ContentValues().apply {
            put("status", status)
            put("last_error", errorMsg.take(200))
        }
        writableDatabase.update("notification_outbox", values, "event_id = ?", arrayOf(eventId))
    }

    @Synchronized
    fun resumeAuthPausedItems() {
        val values = ContentValues().apply {
            put("status", "queued")
            put("next_retry_at", 0L)
        }
        writableDatabase.update("notification_outbox", values, "status = 'auth_paused'", null)
    }

    @Synchronized
    fun pausePendingForAuth(errorMsg: String) {
        val values = ContentValues().apply {
            put("status", "auth_paused")
            put("last_error", errorMsg.take(200))
        }
        writableDatabase.update(
            "notification_outbox", values,
            "status IN ('queued', 'retry_scheduled')", null
        )
    }

    @Synchronized
    fun nextPendingAt(): Long? {
        readableDatabase.rawQuery(
            "SELECT MIN(next_retry_at) FROM notification_outbox WHERE status IN ('queued', 'retry_scheduled')",
            null
        ).use { cursor ->
            return if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
        }
    }

    @Synchronized
    fun contains(eventId: String): Boolean {
        readableDatabase.rawQuery(
            "SELECT 1 FROM notification_outbox WHERE event_id = ? LIMIT 1", arrayOf(eventId)
        ).use { return it.moveToFirst() }
    }

    @Synchronized
    fun migrateLegacyQueue(context: Context) {
        val prefs = context.getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("legacy_migrated_v2", false)) return
        try {
            val queue = JSONArray(prefs.getString("offline_notif_queue", "[]") ?: "[]")
            val importedIds = mutableListOf<String>()
            for (i in 0 until queue.length()) {
                val item = queue.getJSONObject(i)
                val pkg = item.optString("packageName", "unknown")
                val title = redactOtp(item.optString("title", ""))
                val body = redactOtp(item.optString("text", ""))
                val occurredAt = item.optLong("timestamp", System.currentTimeMillis())
                val eventId = item.optString("eventId").takeIf { it.isNotBlank() }
                    ?: computeDeterministicEventId(pkg, i, occurredAt, title, body)
                if (body.isNotBlank()) {
                    enqueue(eventId, pkg, title, body, occurredAt)
                    importedIds.add(eventId)
                }
            }
            check(importedIds.all(::contains)) { "Legacy queue verification failed" }
            check(prefs.edit().remove("offline_notif_queue")
                .putBoolean("legacy_migrated_v2", true).commit()) { "Legacy queue marker failed" }
        } catch (e: Exception) {
            Log.e("QLTC_Noti", "Legacy queue migration failed; source queue retained", e)
        }
    }

    @Synchronized
    fun getQueueStats(): JSONObject {
        val db = readableDatabase
        val stats = JSONObject()
        var queued = 0
        var authPaused = 0
        var failedValidation = 0
        val cursor = db.rawQuery(
            "SELECT status, COUNT(*) FROM notification_outbox GROUP BY status",
            null
        )
        cursor.use { c ->
            while (c.moveToNext()) {
                val st = c.getString(0)
                val cnt = c.getInt(1)
                when (st) {
                    "queued", "retry_scheduled" -> queued += cnt
                    "auth_paused" -> authPaused += cnt
                    "failed_validation" -> failedValidation += cnt
                }
            }
        }
        stats.put("queuedCount", queued)
        stats.put("authPausedCount", authPaused)
        stats.put("failedValidationCount", failedValidation)
        return stats
    }
}

data class OutboxItem(
    val eventId: String,
    val packageName: String,
    val title: String,
    val text: String,
    val occurredAt: Long,
    val status: String,
    val retryCount: Int
)

class BankNotificationListener : NotificationListenerService() {
    private lateinit var outboxDb: NotificationOutboxDb

    private val SUPPORTED_PACKAGES = setOf(
        "com.VCB",
        "com.vietcombank",
        "vn.com.techcombank.bb.app",
        "com.techcombank",
        "com.mbmobile",
        "com.vnpay.bidv",
        "com.vietinbank.ipay",
        "com.ACB",
        "com.tpb.mb.gprsandroid",
        "com.vnpay.vpbankonline",
        "com.mservice.momotransfer",
        "vn.zalopay",
        "com.Sacombank.ewallet",
        "com.shinhan.global.vn.bank",
        "com.vib.myvib2",
        "com.hdbank.mobilebanking",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        "com.android.mms"
    )

    private val FINANCIAL_KEYWORDS = listOf(
        "số dư", "so du", "sd:", "sd ", "vnd", "vnđ", "gd:", "ps:", "tk ", "tài khoản", "tai khoan", "biến động"
    )

    private val OTP_KEYWORDS = listOf(
        "mã otp", "ma otp", "smart otp", "mã xác thực", "ma xac thuc", "verification code", "passcode"
    )

    override fun onCreate() {
        super.onCreate()
        try {
            outboxDb = NotificationOutboxDb(applicationContext)
            outboxDb.migrateLegacyQueue(applicationContext)
            OutboxSyncScheduler.ensurePeriodic(applicationContext)
            OutboxSyncScheduler.scheduleNext(applicationContext, outboxDb)
        } catch (t: Throwable) {
            Log.e(TAG, "BankNotificationListener init warning", t)
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        try {
            val prefs = getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)
            prefs.edit().putLong("last_listener_connected_at", System.currentTimeMillis()).apply()
            OutboxSyncScheduler.scheduleNow(applicationContext)
        } catch (t: Throwable) {
            Log.e(TAG, "BankNotificationListener onListenerConnected warning", t)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val packageName = sbn.packageName ?: return

        val extras = sbn.notification.extras
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
        val fullBody = if (bigText.length > text.length) bigText else text
        if (fullBody.isBlank()) return

        val combinedLower = "$title $fullBody".lowercase()

        // Filter out pure OTP notifications before persisting or sending (V2-04)
        val hasOtp = OTP_KEYWORDS.any { combinedLower.contains(it) }
        val hasBalance = combinedLower.contains("số dư") || combinedLower.contains("so du") || combinedLower.contains("sd:")
        if (hasOtp && !hasBalance) {
            return
        }

        val isSupportedApp = SUPPORTED_PACKAGES.any { packageName.contains(it, ignoreCase = true) }
        val hasFinancialKeyword = FINANCIAL_KEYWORDS.any { combinedLower.contains(it) }
        if (!isSupportedApp && !hasFinancialKeyword) return

        val postTime = if (sbn.postTime > 100_000_000_000L) sbn.postTime else System.currentTimeMillis()
        val redactedTitle = redactOtp(title)
        val redactedBody = redactOtp(fullBody)
        val eventId = computeDeterministicEventId(packageName, sbn.id, postTime, redactedTitle, redactedBody)

        // V2-04: Do NOT log sensitive notification body/amounts to logcat!
        Log.i("QLTC_Noti", "Queued bank notification event=$eventId pkg=$packageName")

        try {
            // Persist synchronously before asking the OS to deliver it. No in-memory queue.
            outboxDb.enqueue(
                eventId = eventId,
                packageName = packageName,
                title = redactedTitle,
                text = redactedBody,
                occurredAt = postTime
            )
            OutboxSyncScheduler.scheduleNow(applicationContext)
        } catch (e: Exception) {
            Log.e("QLTC_Noti", "Could not persist notification event=$eventId", e)
        }
    }

}
