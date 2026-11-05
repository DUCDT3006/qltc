package com.qltc.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("qltc_prefs", Context.MODE_PRIVATE)

        // Kiểm tra quyền Notification Listener
        if (!isNotificationServiceEnabled()) {
            showPermissionSetupScreen()
            return
        }

        // Nếu đã có quyền, mở WebView nạp ứng dụng QLTC
        val webUrl = prefs.getString("web_url", "https://qltc-app.dtd-store.workers.dev") ?: "https://qltc-app.dtd-store.workers.dev"
        loadAppWebView(webUrl)
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

            // Xử lý mở trình duyệt ngoài khi người dùng bấm tải APK
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    val uriStr = uri.toString()
                    if (uriStr.endsWith(".apk") || uri.host?.contains("github.com") == true) {
                        try {
                            val intent = Intent(Intent.ACTION_VIEW, uri)
                            startActivity(intent)
                            return true
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                    return false
                }
            }

            webChromeClient = WebChromeClient()

            // Lắng nghe sự kiện tải file để mở trình quản lý tải xuống / trình duyệt máy
            setDownloadListener { downloadUrl, _, _, _, _ ->
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl))
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Không thể mở link tải: $downloadUrl", Toast.LENGTH_SHORT).show()
                }
            }

            // Gắn Javascript Interface để Web biết được phiên bản APK native
            addJavascriptInterface(AndroidBridge(this@MainActivity), "AndroidBridge")
        }
        setContentView(webView)
        webView.loadUrl(url)
    }

    class AndroidBridge(private val context: Context) {
        @JavascriptInterface
        fun getNativeApkVersion(): String {
            return try {
                val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
                pInfo.versionName ?: "1.0.0"
            } catch (e: Exception) {
                "1.0.0"
            }
        }

        @JavascriptInterface
        fun openExternalUrl(url: String) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
