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
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
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
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(60, 100, 60, 60)
            setBackgroundColor(0xFF0E1314.toInt())
        }

        val title = TextView(this).apply {
            text = "Kích hoạt Tự động đọc Thông báo Ngân hàng"
            textSize = 20f
            setTextColor(0xFFF2F5F5.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        layout.addView(title)

        val desc = TextView(this).apply {
            text = "\nĐể QLTC có thể tự động ghi nhận giao dịch mỗi khi app ngân hàng thông báo tiền vào/ra, bạn cần cấp quyền 'Truy cập thông báo' 1 lần duy nhất.\n\nLưu ý: Ứng dụng tuyệt đối KHÔNG đọc tin nhắn OTP và chỉ xử lý thông báo số dư ngân hàng."
            textSize = 14f
            setTextColor(0xFF869699.toInt())
        }
        layout.addView(desc)

        val btnGrant = Button(this).apply {
            text = "1. Bật Quyền Truy Cập Thông Báo"
            setBackgroundColor(0xFF657D81.toInt())
            setTextColor(0xFFF2F5F5.toInt())
            setOnClickListener {
                startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
            }
        }
        layout.addView(btnGrant)

        val btnBattery = Button(this).apply {
            text = "2. Tắt Tối Ưu Pin (Để chạy ngầm liên tục)"
            setBackgroundColor(0xFF232D30.toInt())
            setTextColor(0xFFF2F5F5.toInt())
            setOnClickListener {
                requestIgnoreBatteryOptimizations()
            }
        }
        layout.addView(btnBattery)

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

        setContentView(layout)
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
            webViewClient = WebViewClient()
        }
        setContentView(webView)
        webView.loadUrl(url)
    }
}
