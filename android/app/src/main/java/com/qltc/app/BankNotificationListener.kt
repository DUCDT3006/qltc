package com.qltc.app

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class BankNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "QLTC_Notification"

        // Danh sách các package ngân hàng, ví điện tử & ứng dụng SMS tại Việt Nam
        val SUPPORTED_BANK_PACKAGES = setOf(
            "com.VCB",                         // Vietcombank Digibank
            "com.vcb.digibank",
            "com.mbmobile",                     // MB Bank
            "vn.com.techcombank.bb.app",        // Techcombank
            "mobile.acb.com.vn",                // ACB ONE
            "com.tpb.mb.gprsandroid",           // TPBank
            "com.vnpay.vpbankonline",           // VPBank NEO
            "com.vnpay.bidv",                   // BIDV SmartBanking
            "com.vietinbank.ipay",              // VietinBank iPay
            "com.msb.mb.gprsandroid",           // MSB mBank
            "vn.shb.mbanking",                  // SHB Mobile
            "com.vnpay.hdbank",                 // HDBank
            "com.hdbank.mb",
            "com.ocb.omni",                     // OCB OMNI
            "vn.vib.vivid",                     // VIB
            "vn.com.sacombank.mbanking",        // Sacombank Pay
            "vn.be.cake",                       // Cake by VPBank
            "timo.vn.bank",                     // Timo
            "vn.com.vng.zalopay",               // ZaloPay (loại bỏ com.zing.zalo để tránh cuộc gọi/chat riêng)
            "com.mservice.momotransfer",        // MoMo
            "com.viettel.viettelmoney",         // Viettel Money
            "com.vnpay.bill",                   // VNPAY
            "com.google.android.apps.messaging",// SMS Google
            "com.samsung.android.messaging",    // SMS Samsung
            "com.android.mms"                   // SMS Xiaomi / OPPO / Vivo
        )
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val packageName = sbn.packageName ?: return

        // 1. Chỉ lọc các app nằm trong danh sách ngân hàng / SMS
        if (!SUPPORTED_BANK_PACKAGES.contains(packageName)) {
            return
        }

        val extras = sbn.notification?.extras ?: return
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""

        val fullBody = if (bigText.isNotBlank()) bigText else text
        if (fullBody.isBlank() && title.isBlank()) return

        val combined = "$title $fullBody"

        // 2. Tuyệt đối lọc bỏ mã OTP / mã xác thực để đảm bảo an toàn tuyệt đối
        if (combined.contains("OTP", ignoreCase = true) ||
            combined.contains("mã xác nhận", ignoreCase = true) ||
            combined.contains("ma xac thuc", ignoreCase = true) ||
            combined.contains("mã kích hoạt", ignoreCase = true)) {
            Log.d(TAG, "Đã bỏ qua thông báo OTP vì lý do bảo mật.")
            return
        }

        // 3. Nhận diện dấu hiệu số tiền (+, -, VND, VNĐ, số + đ) ở cả Title lẫn Body
        val hasMoneySign = combined.contains("+") || combined.contains("-") ||
                           combined.contains("VND", ignoreCase = true) ||
                           combined.contains("VNĐ", ignoreCase = true) ||
                           Regex("""\d+\s*[đd]""").containsMatchIn(combined)

        if (!hasMoneySign) {
            return
        }

        Log.i(TAG, "Phát hiện biến động số dư từ $packageName: $title - $fullBody")

        // 4. Gửi lên Cloudflare Worker backend kèm thời gian thực tế xảy ra thông báo
        val postTime = sbn.postTime
        sendToBackend(packageName, title, fullBody, postTime)
    }

    private fun sendToBackend(packageName: String, title: String, text: String, postTime: Long = System.currentTimeMillis()) {
        val prefs = getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)
        val backendUrl = prefs.getString("backend_url", "https://qltc-backend.dtd-store.workers.dev") ?: "https://qltc-backend.dtd-store.workers.dev"

        CoroutineScope(Dispatchers.IO).launch {
            // Thử đẩy các thông báo offline tồn đọng trước đó (nếu có)
            flushOfflineQueue(backendUrl, prefs)

            val payload = JSONObject().apply {
                put("packageName", packageName)
                put("title", title)
                put("text", text)
                put("occurredAt", postTime)
                put("userId", prefs.getString("user_id", "user_default"))
            }

            val success = postJsonToBackend("$backendUrl/api/notifications/ingest", payload)
            if (!success) {
                // Nếu mất mạng hoặc gửi thất bại, lưu vào hàng đợi offline trong SharedPreferences
                enqueueOfflineNotif(prefs, payload)
            }
        }
    }

    private fun postJsonToBackend(endpoint: String, payload: JSONObject): Boolean {
        return try {
            val url = URL(endpoint)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json; utf-8")
            conn.setRequestProperty("Accept", "application/json")
            conn.doOutput = true
            conn.connectTimeout = 8000
            conn.readTimeout = 8000

            OutputStreamWriter(conn.outputStream).use { writer ->
                writer.write(payload.toString())
                writer.flush()
            }

            val responseCode = conn.responseCode
            conn.disconnect()
            responseCode in 200..299
        } catch (e: Exception) {
            Log.e(TAG, "Lỗi gửi thông báo: ${e.message}")
            false
        }
    }

    private fun enqueueOfflineNotif(prefs: android.content.SharedPreferences, payload: JSONObject) {
        try {
            val existing = prefs.getString("offline_notif_queue", "[]") ?: "[]"
            val jsonArray = org.json.JSONArray(existing)
            jsonArray.put(payload)
            prefs.edit().putString("offline_notif_queue", jsonArray.toString()).apply()
            Log.w(TAG, "Đã lưu thông báo vào hàng đợi offline (Tổng: ${jsonArray.length()})")
        } catch (e: Exception) {
            Log.e(TAG, "Lỗi lưu offline: ${e.message}")
        }
    }

    private fun flushOfflineQueue(backendUrl: String, prefs: android.content.SharedPreferences) {
        val existing = prefs.getString("offline_notif_queue", null) ?: return
        try {
            val jsonArray = org.json.JSONArray(existing)
            if (jsonArray.length() == 0) return

            Log.i(TAG, "Đang gửi lại ${jsonArray.length()} thông báo offline...")
            val remaining = org.json.JSONArray()
            for (i in 0 until jsonArray.length()) {
                val item = jsonArray.getJSONObject(i)
                val ok = postJsonToBackend("$backendUrl/api/notifications/ingest", item)
                if (!ok) {
                    remaining.put(item)
                }
            }
            prefs.edit().putString("offline_notif_queue", remaining.toString()).apply()
        } catch (e: Exception) {
            Log.e(TAG, "Lỗi flush offline queue: ${e.message}")
        }
    }
}
