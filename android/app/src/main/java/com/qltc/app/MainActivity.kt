package com.qltc.app

import android.app.AlertDialog
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import android.text.InputType
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val pairingDialogOpen = AtomicBoolean(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        DeviceCredentialStore(this).read() // Migrate only a legacy device token; discard plaintext owner fallback.
        OutboxSyncScheduler.ensurePeriodic(applicationContext)
        val outboxDb = NotificationOutboxDb(this)
        try {
            OutboxSyncScheduler.scheduleNext(applicationContext, outboxDb)
        } finally {
            outboxDb.close()
        }

        // Kiểm tra quyền Notification Listener
        if (!isNotificationServiceEnabled()) {
            showPermissionSetupScreen()
            return
        }

        // Nếu đã có quyền, mở WebView nạp ứng dụng QLTC
        loadAppWebView(APP_URL)
    }

    override fun onResume() {
        super.onResume()
        OutboxSyncScheduler.scheduleNow(applicationContext)
    }

    private fun isNotificationServiceEnabled(): Boolean {
        val pkgName = packageName
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        if (!TextUtils.isEmpty(flat)) {
            val names = flat.split(":").toTypedArray()
            for (name in names) {
                val cn = ComponentName.unflattenFromString(name)
                if (cn != null && TextUtils.equals(pkgName, cn.packageName)) {
                    return true
                }
            }
        }
        return false
    }

    private fun showPermissionSetupScreen() {
        val scrollView = ScrollView(this).apply {
            setBackgroundColor(0xFF0E1314.toInt())
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(50, 70, 50, 60)
        }

        val title = TextView(this).apply {
            text = "Kích hoạt Tự động đọc Thông báo Ngân hàng"
            textSize = 20f
            setTextColor(0xFFF2F5F5.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        layout.addView(title)

        val desc = TextView(this).apply {
            text = "\nĐể QLTC có thể tự động ghi nhận giao dịch mỗi khi app ngân hàng thông báo tiền vào/ra, bạn cần cấp quyền 'Truy cập thông báo' 1 lần duy nhất.\n\n⚠️ Lưu ý (Android 13/14+):\nNếu mục QLTC bị làm mờ chưa gạt được: Bấm nút 'Cài đặt bị hạn chế' bên dưới > Bấm dấu 3 chấm góc phải trên cùng > Chọn 'Cho phép cài đặt bị hạn chế' (Allow restricted settings), sau đó quay lại gạt bật quyền.\n\n🔒 An toàn tuyệt đối: Ứng dụng KHÔNG đọc mã OTP và KHÔNG yêu cầu mật khẩu ngân hàng."
            textSize = 13.5f
            setTextColor(0xFF869699.toInt())
            setLineSpacing(4f, 1.15f)
        }
        layout.addView(desc)

        // 1. Nút mở Cài đặt thông báo
        val btnGrant = Button(this).apply {
            text = "1. Bật Quyền Truy Cập Thông Báo"
            setBackgroundColor(0xFF657D81.toInt())
            setTextColor(0xFFF2F5F5.toInt())
            setOnClickListener {
                startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
            }
        }
        layout.addView(btnGrant)

        // 2. Nút mở App Info để gỡ Restricted Settings trên Android 13/14+
        val btnRestricted = Button(this).apply {
            text = "⭐ Mở cài đặt app (Nếu bị mờ công tắc)"
            setBackgroundColor(0xFF232E31.toInt())
            setTextColor(0xFF8CC7AE.toInt())
            setOnClickListener {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            }
        }
        layout.addView(btnRestricted)

        // 3. Tắt tối ưu pin
        val btnBattery = Button(this).apply {
            text = "2. Tắt Tối Ưu Pin (Chạy ngầm liên tục)"
            setBackgroundColor(0xFF1C2426.toInt())
            setTextColor(0xFFD5E1E3.toInt())
            setOnClickListener {
                requestIgnoreBatteryOptimizations()
            }
        }
        layout.addView(btnBattery)

        // 4. Tiếp tục
        val btnContinue = Button(this).apply {
            text = "3. Tôi Đã Bật Xong › Mở Ứng Dụng"
            setBackgroundColor(0xFF8CC7AE.toInt())
            setTextColor(0xFF0E1314.toInt())
            setOnClickListener {
                if (isNotificationServiceEnabled()) {
                    recreate()
                } else {
                    Toast.makeText(this@MainActivity, "Bạn chưa bật quyền truy cập thông báo cho QLTC", Toast.LENGTH_LONG).show()
                }
            }
        }
        layout.addView(btnContinue)

        scrollView.addView(layout)
        setContentView(scrollView)
    }

    private fun requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            } else {
                Toast.makeText(this, "Đã được miễn trừ tối ưu pin!", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun loadAppWebView(url: String) {
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.safeBrowsingEnabled = true

            // Xử lý mở trình duyệt ngoài khi người dùng bấm tải APK
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return true
                    val isTrustedOrigin = uri.scheme == "https" && uri.host == APP_HOST &&
                        (uri.port == -1 || uri.port == 443)
                    if (isTrustedOrigin) {
                        if (request.isForMainFrame) {
                            view?.addJavascriptInterface(AndroidBridge(this@MainActivity), "AndroidBridge")
                        }
                        return false
                    }
                    val isCloudflareAccess = uri.scheme == "https" &&
                        uri.host?.endsWith(".cloudflareaccess.com", ignoreCase = true) == true &&
                        (uri.port == -1 || uri.port == 443)
                    if (request.isForMainFrame && isCloudflareAccess) {
                        // Access login must stay in this WebView to preserve its session.
                        // Remove the frame-visible bridge before loading the identity page.
                        view?.removeJavascriptInterface("AndroidBridge")
                        return false
                    }
                    // addJavascriptInterface is visible to every frame. Keep untrusted origins
                    // out of the WebView so third-party frames cannot invoke the native bridge.
                    if (request.isForMainFrame) {
                        view?.removeJavascriptInterface("AndroidBridge")
                        if (uri.scheme == "https") openSafeExternalUrl(uri)
                    }
                    return true
                }

                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    val uri = Uri.parse(url ?: return)
                    val isTrustedOrigin = uri.scheme == "https" && uri.host == APP_HOST &&
                        (uri.port == -1 || uri.port == 443)
                    if (isTrustedOrigin) {
                        view?.addJavascriptInterface(AndroidBridge(this@MainActivity), "AndroidBridge")
                    } else {
                        // Also cover server redirects, which may not pass through URL override.
                        view?.removeJavascriptInterface("AndroidBridge")
                    }
                }
            }

            webChromeClient = WebChromeClient()

            // Lắng nghe sự kiện tải file để mở trình quản lý tải xuống / trình duyệt máy
            setDownloadListener { downloadUrl, _, _, _, _ ->
                try {
                    val downloadUri = Uri.parse(downloadUrl)
                    if (downloadUri.scheme == "https") openSafeExternalUrl(downloadUri)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Không thể mở liên kết tải", Toast.LENGTH_SHORT).show()
                }
            }

            // Gắn Javascript Interface để Web biết được phiên bản APK native
            addJavascriptInterface(AndroidBridge(this@MainActivity), "AndroidBridge")
        }
        setContentView(webView)
        webView.loadUrl(url)
    }

    private fun openSafeExternalUrl(uri: Uri) {
        if (uri.scheme != "https") return
        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        catch (_: Exception) { Toast.makeText(this, "Không thể mở liên kết", Toast.LENGTH_SHORT).show() }
    }

    private fun showPairingDialog() {
        if (!pairingDialogOpen.compareAndSet(false, true)) return
        val input = EditText(this).apply {
            hint = "Mã ghép thiết bị"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            setSingleLine(true)
        }
        AlertDialog.Builder(this)
            .setTitle("Ghép thiết bị nhận thông báo")
            .setMessage("Nhập mã một lần do tài khoản chủ tạo trong phần Cài đặt.")
            .setView(input)
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Ghép thiết bị") { _, _ ->
                val code = input.text.toString().trim()
                if (code.isBlank()) {
                    Toast.makeText(this, "Vui lòng nhập mã ghép", Toast.LENGTH_SHORT).show()
                } else {
                    Thread { exchangePairCode(code) }.start()
                }
            }
            .setOnDismissListener { pairingDialogOpen.set(false) }
            .show()
    }

    private fun exchangePairCode(code: String) {
        var connection: HttpURLConnection? = null
        try {
            connection = (URL(BackendApiConfig.endpoint(this, "auth/pair-exchange")).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                connectTimeout = 10000
                readTimeout = 10000
                doOutput = true
            }
            val body = JSONObject().put("code", code).put("deviceName", "QLTC Android")
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
            val status = connection.responseCode
            if (status !in 200..299) {
                runOnUiThread { Toast.makeText(this, "Mã ghép không hợp lệ hoặc đã hết hạn (HTTP $status)", Toast.LENGTH_LONG).show() }
                return
            }
            val response = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val token = response.optString("deviceToken")
            DeviceCredentialStore(this).save(token)
            NotificationOutboxDb(this).resumeAuthPausedItems()
            getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE).edit().remove("last_ingest_error").apply()
            OutboxSyncScheduler.scheduleNow(applicationContext)
            runOnUiThread { Toast.makeText(this, "Đã ghép thiết bị; đang gửi thông báo chờ", Toast.LENGTH_LONG).show() }
        } catch (e: Exception) {
            runOnUiThread { Toast.makeText(this, "Ghép thiết bị thất bại; kiểm tra mạng và tạo mã mới nếu cần", Toast.LENGTH_LONG).show() }
        } finally {
            connection?.disconnect()
        }
    }

    class AndroidBridge(private val activity: MainActivity) {
        @JavascriptInterface
        fun getNativeApkVersion(): String {
            return try {
                val pInfo = activity.packageManager.getPackageInfo(activity.packageName, 0)
                pInfo.versionName ?: "1.0.0"
            } catch (e: Exception) {
                "1.0.0"
            }
        }

        @JavascriptInterface
        fun openExternalUrl(url: String) {
            activity.runOnUiThread { activity.openSafeExternalUrl(Uri.parse(url)) }
        }

        @JavascriptInterface
        fun openDevicePairing() {
            activity.runOnUiThread { activity.showPairingDialog() }
        }

        @JavascriptInterface
        fun getListenerDiagnostics(): String {
            val context = activity.applicationContext
            val prefs = context.getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)
            val outboxStats = try {
                NotificationOutboxDb(context).getQueueStats()
            } catch (_: Exception) {
                org.json.JSONObject()
            }
            val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
            val permissionGranted = flat.contains(context.packageName)
            val result = org.json.JSONObject().apply {
                put("permissionGranted", permissionGranted)
                put("lastConnectedAt", prefs.getLong("last_listener_connected_at", 0L))
                put("lastIngestSuccessAt", prefs.getLong("last_ingest_success_at", 0L))
                put("lastIngestError", prefs.getString("last_ingest_error", null))
                put("hasDeviceToken", DeviceCredentialStore(context).read() != null)
                put("queuedCount", outboxStats.optInt("queuedCount", 0))
                put("authPausedCount", outboxStats.optInt("authPausedCount", 0))
                put("failedValidationCount", outboxStats.optInt("failedValidationCount", 0))
            }
            return result.toString()
        }
    }

    companion object {
        private const val APP_HOST = "qltc-app.dtd-store.workers.dev"
        private const val APP_URL = "https://$APP_HOST"
    }

    override fun onBackPressed() {
        if (::webView.isInitialized) {
            webView.evaluateJavascript("typeof window.__handleBackPress === 'function' ? window.__handleBackPress() : false") { result ->
                val handled = result == "true"
                if (!handled) {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        super.onBackPressed()
                    }
                }
            }
        } else {
            super.onBackPressed()
        }
    }
}
