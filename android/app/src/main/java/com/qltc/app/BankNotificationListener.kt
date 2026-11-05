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

        // 4. Gửi lên Cloudflare Worker backend
        sendToBackend(packageName, title, fullBody)
    }

    private fun sendToBackend(packageName: String, title: String, text: String) {
        val prefs = getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)
        val backendUrl = prefs.getString("backend_url", "https://qltc-backend.dtd-store.workers.dev") ?: "https://qltc-backend.dtd-store.workers.dev"

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val url = URL("$backendUrl/api/notifications/ingest")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json; utf-8")
                conn.setRequestProperty("Accept", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 10000
                conn.readTimeout = 10000

                val payload = JSONObject().apply {
                    put("packageName", packageName)
                    put("title", title)
                    put("text", text)
                    put("userId", prefs.getString("user_id", "user_default"))
                }

                OutputStreamWriter(conn.outputStream).use { writer ->
                    writer.write(payload.toString())
                    writer.flush()
                }

                val responseCode = conn.responseCode
                Log.d(TAG, "Kết quả gửi lên backend: $responseCode")
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Lỗi khi gửi thông báo lên backend: ${e.message}")
            }
        }
    }
}
