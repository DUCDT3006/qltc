package com.qltc.app

import android.app.AlertDialog
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var errorOverlay: View
    private val pairingDialogOpen = AtomicBoolean(false)
    private var mainFrameLoading = false
    private var mainFrameFailed = false
    private var mainFrameUrl: String? = null
    private var retryUrl = APP_URL
    @Volatile private var bridgeAttached = false
    private val androidBridge by lazy { AndroidBridge(this) }
    private var intentionalRestartUrl: String? = null
    private lateinit var loadErrorTitle: TextView
    private lateinit var loadErrorDetail: TextView
    private val loadTimeout = Runnable {
        if (mainFrameLoading && !mainFrameFailed) {
            showLoadFailure(
                "Tải ứng dụng quá lâu",
                "Kiểm tra kết nối mạng rồi nhấn Thử lại.",
                mainFrameUrl ?: retryUrl
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Native background service initialization safely in thread (never block or crash UI)
        Thread {
            try {
                DeviceCredentialStore(applicationContext).read()
                OutboxSyncScheduler.ensurePeriodic(applicationContext)
                val outboxDb = NotificationOutboxDb(applicationContext)
                try {
                    OutboxSyncScheduler.scheduleNext(applicationContext, outboxDb)
                } finally {
                    outboxDb.close()
                }
            } catch (t: Throwable) {
                android.util.Log.e("QLTC_Init", "Native background service init warning (non-fatal)", t)
            }
        }.start()

        // Kiểm tra quyền Notification Listener
        if (!isNotificationServiceEnabled()) {
            showPermissionSetupScreen()
            return
        }

        // Nếu đã có quyền, mở WebView nạp ứng dụng QLTC
        val prefs = getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)
        val webUrl = prefs.getString("web_url", APP_URL) ?: APP_URL
        loadAppWebView(webUrl)
    }

    override fun onResume() {
        super.onResume()
        try {
            OutboxSyncScheduler.scheduleNow(applicationContext)
        } catch (t: Throwable) {
            android.util.Log.e("QLTC_Resume", "Failed to schedule outbox on resume", t)
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.removeCallbacks(loadTimeout)
        super.onDestroy()
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
        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
        // Keep the bridge on the app origin, including when a stored URL is stale.
        val startUrl = if (isAppUrl(url)) url else APP_URL
        retryUrl = startUrl
        mainFrameUrl = startUrl
        mainFrameLoading = true
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

            // Xử lý mở trình duyệt ngoài khi người dùng bấm tải APK
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    if (url == null) return
                    val shouldAttachBridge = isAppUrl(url)
                    val wasAttached = bridgeAttached
                    setBridgeAttached(shouldAttachBridge)
                    if (!shouldAttachBridge && !isAccessUrl(url)) {
                        view?.stopLoading()
                        mainFrameLoading = false
                        webView.removeCallbacks(loadTimeout)
                        openSafeExternalUrl(Uri.parse(url))
                        return
                    }
                    // POST navigations bypass shouldOverrideUrlLoading. Restart once so
                    // the add/remove of the JS bridge applies before document scripts run.
                    if (wasAttached != shouldAttachBridge) {
                        intentionalRestartUrl = url
                        view?.stopLoading()
                        view?.let { target ->
                            target.post { if (!isFinishing && !isDestroyed) target.loadUrl(url) }
                        }
                        return
                    }
                    if (intentionalRestartUrl == url) intentionalRestartUrl = null
                    mainFrameUrl = url
                    mainFrameLoading = true
                    mainFrameFailed = false
                    errorOverlay.visibility = View.GONE
                    scheduleLoadTimeout()
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    if (url != mainFrameUrl && url != view?.url) return
                    mainFrameLoading = false
                    webView.removeCallbacks(loadTimeout)
                    if (!mainFrameFailed) errorOverlay.visibility = View.GONE
                }

                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    if (request == null) return false
                    val uri = request.url
                    if (!request.isForMainFrame) return !isAppUrl(uri.toString())
                    if (isAccessUrl(uri.toString())) {
                        setBridgeAttached(false)
                    } else if (uri.path?.endsWith(".apk", ignoreCase = true) == true || !isAppUrl(uri.toString())) {
                        openSafeExternalUrl(uri)
                        return true
                    } else {
                        setBridgeAttached(true)
                    }
                    // Called for main-frame redirects too, including a target whose TLS
                    // handshake fails before onPageStarted can report its URL.
                    mainFrameUrl = uri.toString()
                    mainFrameLoading = true
                    scheduleLoadTimeout()
                    return false
                }

                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                    if (request?.isForMainFrame != false || !bridgeAttached) return null
                    val destination = request.requestHeaders.entries
                        .firstOrNull { it.key.equals("Sec-Fetch-Dest", ignoreCase = true) }
                        ?.value?.lowercase()
                    if ((destination == "iframe" || destination == "frame" || destination == "document") &&
                        !isAppUrl(request.url.toString())) {
                        return WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                    }
                    return null
                }

                override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                    // This callback has no isForMainFrame flag. Compare against the active
                    // document URL so a failed image/script does not replace the entire app.
                    handler?.cancel()
                    val failedUrl = error?.url
                    android.util.Log.e("QLTC_Web", "SSL error: ${error?.primaryError} at $failedUrl")
                    if (mainFrameLoading && failedUrl != null && failedUrl == mainFrameUrl) {
                        showLoadFailure(
                            "Kết nối không an toàn",
                            "Không thể xác minh chứng chỉ của trang. Kiểm tra ngày giờ và kết nối mạng, rồi thử lại.",
                            failedUrl
                        )
                    }
                }

                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    if (request?.isForMainFrame != true) return
                    if (request.url.toString() == intentionalRestartUrl) {
                        intentionalRestartUrl = null
                        return
                    }
                    android.util.Log.e("QLTC_Web", "Main document error ${error?.errorCode}: ${error?.description}")
                    showLoadFailure(
                        "Không tải được ứng dụng",
                        "Kiểm tra kết nối mạng rồi nhấn Thử lại.",
                        request.url.toString()
                    )
                }

                override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: android.webkit.WebResourceResponse?) {
                    if (request?.isForMainFrame != true) return
                    val status = errorResponse?.statusCode ?: 0
                    android.util.Log.e("QLTC_Web", "Main document HTTP $status at ${request.url}")
                    showLoadFailure(
                        "Máy chủ chưa sẵn sàng",
                        "Trang trả về lỗi HTTP $status. Vui lòng thử lại sau.",
                        request.url.toString()
                    )
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    android.util.Log.d("QLTC_Web", "[JS Console]: ${consoleMessage?.message()} (${consoleMessage?.sourceId()}:${consoleMessage?.lineNumber()})")
                    return true
                }
            }

            // Lắng nghe sự kiện tải file để mở trình quản lý tải xuống / trình duyệt máy
            setDownloadListener { downloadUrl, _, _, _, _ ->
                this@MainActivity.openSafeExternalUrl(Uri.parse(downloadUrl))
            }

            // Gắn Javascript Interface để Web biết được phiên bản APK native
            addJavascriptInterface(androidBridge, "AndroidBridge")
            bridgeAttached = true
        }
        val container = FrameLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        errorOverlay = createLoadErrorOverlay().also {
            container.addView(it, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        setContentView(container)
        scheduleLoadTimeout()
        webView.loadUrl(startUrl)
    }

    private fun scheduleLoadTimeout() {
        webView.removeCallbacks(loadTimeout)
        webView.postDelayed(loadTimeout, 30_000L)
    }

    private fun isAppUrl(url: String): Boolean {
        val uri = Uri.parse(url)
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(APP_HOST, ignoreCase = true) &&
            uri.userInfo == null && (uri.port == -1 || uri.port == 443)
    }

    private fun isAccessUrl(url: String): Boolean {
        val uri = Uri.parse(url)
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host?.endsWith(".cloudflareaccess.com", ignoreCase = true) == true &&
            uri.userInfo == null && (uri.port == -1 || uri.port == 443)
    }

    private fun setBridgeAttached(attach: Boolean) {
        if (bridgeAttached == attach) return
        if (attach) webView.addJavascriptInterface(androidBridge, "AndroidBridge")
        else webView.removeJavascriptInterface("AndroidBridge")
        bridgeAttached = attach
    }

    private fun createLoadErrorOverlay(): View {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(40, 40, 40, 40)
            setBackgroundColor(0xFF0E1314.toInt())
            visibility = View.GONE
        }
        val title = TextView(this).apply {
            id = View.generateViewId()
            textSize = 21f
            setTextColor(0xFFF2F5F5.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        val detail = TextView(this).apply {
            id = View.generateViewId()
            textSize = 15f
            setTextColor(0xFFD5E1E3.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 20, 0, 24)
        }
        val retry = Button(this).apply {
            text = "Thử lại"
            setOnClickListener {
                mainFrameFailed = false
                mainFrameLoading = true
                mainFrameUrl = retryUrl
                layout.visibility = View.GONE
                scheduleLoadTimeout()
                webView.loadUrl(retryUrl)
            }
        }
        layout.addView(title)
        layout.addView(detail)
        layout.addView(retry)
        loadErrorTitle = title
        loadErrorDetail = detail
        return layout
    }

    private fun showLoadFailure(title: String, detail: String, failedUrl: String) {
        if (mainFrameFailed) return
        mainFrameFailed = true
        mainFrameLoading = false
        webView.removeCallbacks(loadTimeout)
        retryUrl = if (isAppUrl(failedUrl)) failedUrl else APP_URL
        loadErrorTitle.text = title
        loadErrorDetail.text = detail
        errorOverlay.visibility = View.VISIBLE
        webView.stopLoading()
    }

    private fun openSafeExternalUrl(uri: Uri) {
        if (!uri.scheme.equals("https", ignoreCase = true)) {
            Toast.makeText(this, "Chỉ mở được liên kết HTTPS", Toast.LENGTH_SHORT).show()
            return
        }
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
            if (mainFrameFailed) {
                if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
                return
            }
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
