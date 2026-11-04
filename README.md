# QLTC - Ứng dụng Quản lý Tài chính Cá nhân (Android & Cloudflare)

Ứng dụng quản lý tài chính cá nhân hiện đại, giao diện phong cách **Dark Matte Luxury & Calm Minimalist** (tone màu chủ đạo `#657D81`), tích hợp:
- **Tự động đọc thông báo/SMS biến động số dư** từ nhiều app ngân hàng trên Android qua `NotificationListenerService`.
- **Hộp thư chờ duyệt (Inbox Swipe)** thông minh, chống ghi nhận trùng lặp, tự phát hiện chuyển tiền nội bộ.
- **Tùy biến đa nguồn thu** & bộ mô phỏng phân bổ **6 Hũ chi tiêu (JARS)** chỉ với 1 chạm.
- **Quản lý danh mục đầu tư đa tài sản**: Cổ phiếu VN (HOSE/HNX), Chứng chỉ quỹ (CCQ), Tiền mã hóa (Crypto) và Vàng nhẫn 9999 SJC với tỷ suất sinh lời XIRR.
- **Hạ tầng 100% miễn phí**: Cloudflare Workers, Cloudflare D1 (SQLite), Cloudflare KV & Cloudflare Pages.

---

## 📁 Cấu trúc dự án

```
QLTC cá nhân/
├── backend/              # Cloudflare Worker API (Hono + TypeScript + D1 Database)
│   ├── src/
│   │   ├── services/
│   │   │   ├── parser.ts # Bộ bóc tách thông báo ngân hàng (VCB, MB, TCB, ACB, TPB, etc.)
│   │   │   ├── rules.ts  # Bộ quy tắc tự động phân loại danh mục & hũ
│   │   │   └── dedupe.ts # Thuật toán băm SHA-256 chống ghi nhận trùng
│   │   └── index.ts      # REST API endpoints & Cron triggers
│   ├── schema.sql        # Cấu trúc bảng SQLite chuẩn D1
│   └── wrangler.jsonc    # Cấu hình Cloudflare
│
├── frontend/             # Giao diện Web App / PWA (React 19 + Vite + Tailwind CSS)
│   ├── src/
│   │   ├── components/   # Navbar, BottomNav, Sparkline, DonutChart, QuickAddModal
│   │   ├── views/        # Dashboard, InboxSwipe, Budget, Investments
│   │   └── mockData.ts   # Dữ liệu mẫu ban đầu
│   └── index.html
│
├── android/              # Native Android App (Kotlin)
│   └── app/src/main/
│       ├── java/com/qltc/app/
│       │   ├── BankNotificationListener.kt # Service ngầm đón thông báo OTT/SMS ngân hàng
│       │   └── MainActivity.kt            # Giao diện cấp quyền 1-click & WebView
│       └── AndroidManifest.xml
│
└── .github/workflows/    # CI/CD tự động build file APK cài đặt lên điện thoại
    └── build-apk.yml
```

---

## 🚀 Hướng dẫn chạy thử nghiệm

### 1. Khởi chạy Giao diện (Frontend)
```bash
cd frontend
npm install
npm run dev
```
Mở trình duyệt tại: `http://localhost:3000` (hoặc mở trên điện thoại cùng mạng Wi-Fi).

### 2. Khởi chạy Backend (Cloudflare Worker Local)
```bash
cd backend
npm install
npm run dev
```
Backend sẽ khởi chạy tại: `http://localhost:8787`.

Để nạp dữ liệu mẫu ban đầu:
```bash
curl -X POST http://localhost:8787/api/seed
```

### 3. Cài đặt lên điện thoại Android
1. Push mã nguồn lên repository GitHub của anh (`master` branch).
2. GitHub Actions sẽ tự động biên dịch file `.apk` trong tab **Actions** -> Tải về và cài vào điện thoại Android.
3. Khi mở app lần đầu, bấm **"1. Bật Quyền Truy Cập Thông Báo"** và gạt bật cho **QLTC**.
4. Bấm **"2. Tắt Tối Ưu Pin"** để đảm bảo app nhận thông báo liên tục kể cả khi màn hình tắt.

---

## 🔒 Cam kết bảo mật dữ liệu
- Ứng dụng **tuyệt đối KHÔNG đọc mã OTP** (tất cả thông báo chứa OTP tự động bị loại bỏ ngay tại lớp hệ điều hành).
- Không yêu cầu và không lưu trữ mật khẩu đăng nhập Internet Banking.
- Dữ liệu lưu trữ hoàn toàn trên cơ sở dữ liệu riêng của anh (Cloudflare D1 / SQLite trên máy).
