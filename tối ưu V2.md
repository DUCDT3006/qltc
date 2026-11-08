# PHƯƠNG ÁN SỬA LOGIC, CÔNG THỨC VÀ UI/UX — QLTC CÁ NHÂN V2

> Ngày lập: **08/11/2026 — UTC+7**. Mã nguồn tham chiếu: commit `2f7f1fc`.
>
> Đây là **đặc tả đề xuất để triển khai sau**, chưa phải báo cáo đã sửa hoặc đã nghiệm thu. Lượt lập tài liệu chỉ tạo file Markdown này; không thay đổi mã ứng dụng, database, cấu hình triển khai hay phiên bản.
>
> Workspace: `D:\@Dư án softwear\QLTC cá nhân`. Đường dẫn file bên dưới tính từ thư mục này. Số dòng trong báo cáo trước là vị trí tham chiếu tại thời điểm rà soát; agent triển khai phải tìm lại theo tên hàm/endpoint.

## 1. Phạm vi và căn cứ

V2 xử lý đủ **26 vấn đề** đã liệt kê với anh: tính toàn vẹn dữ liệu, công thức báo cáo và khả năng sử dụng. V2 bổ sung hợp đồng dữ liệu, phương án chuyển dữ liệu cũ, thứ tự triển khai và các tình huống nghiệm thu cụ thể.

- Kiến trúc hiện tại: React/Vite/Tailwind PWA; Hono Worker và Cloudflare D1; Kotlin NotificationListenerService cùng WebView.
- Đã rà mã nguồn và chạy kiểm tra TypeScript frontend/backend ở lượt đánh giá; các kiểm tra đó đạt. Đã tái hiện bằng mã thật lỗi parser đọc ngày thành số tiền, cộng trùng nguồn thu và bộ chuyển đổi bỏ thông tin tài khoản.
- Chưa thực hiện kiểm tra dữ liệu D1 production, cấu hình Cloudflare Access thực tế, hành vi trên điện thoại hoặc kiểm tra giao diện bằng ảnh chụp. Các test ở V2 là **yêu cầu phải thực hiện khi triển khai**, không được ghi nhận là đã PASS.
- Việc số phiên bản khác nhau trong quá trình cập nhật là chủ ý phát triển của anh, **không được tính là lỗi**. Chỉ kiểm tra đồng nhất phiên bản tại thời điểm chốt một bản phát hành.
- `tối ưu V1.md` vẫn là tài liệu tham khảo. Nếu V1 khác V2 về ghi sổ, phân loại bằng ID, kế hoạch theo kỳ, migration hoặc kiểm chứng, dùng hợp đồng V2. Đặc biệt: không ghi đè số dư từ `balanceAfter` của giao dịch pending; không tự seed trong API đọc; không cộng tiền theo so khớp tên gần đúng.

## 2. Nguyên tắc triển khai

1. **Dữ liệu thật được bảo toàn.** Sao lưu trước migration; thử trên database bản sao; có số lượng bản ghi và tổng tiền đối soát trước/sau. Không reset để làm test xanh, không tự tính lại lịch sử vào số dư hiện tại.
2. **Backend quyết định dữ liệu đã ghi sổ.** Frontend chỉ hiển thị bản đã được xác nhận hoặc bản nháp có nhãn chờ đồng bộ. Không có hai thuật toán ghi sổ độc lập ở frontend và backend.
3. **Mỗi yêu cầu tài chính có khóa chống lặp và revision.** Retry cùng yêu cầu không được cộng tiền lần nữa; sửa dữ liệu đã thay đổi trên thiết bị khác phải báo xung đột.
4. **Số liệu tổng và chi tiết phải đối soát được.** Cùng kỳ, múi giờ, bộ lọc, quy tắc phân loại và nguồn dữ liệu. Không dùng `Math.max(local, server)` để che chênh lệch.
5. **Tách số tiền giao dịch khỏi đơn giá tài sản.** Số tiền ghi sổ là số nguyên VND; số lượng tài sản và NAV/đơn giá có thể có phần thập phân hợp lệ, phải giữ độ chính xác đến bước tính giá trị cuối cùng.
6. **Không mở rộng dự án vô điều kiện.** Sửa theo từng nhóm requirement bên dưới. Module hoặc endpoint mới ghi rõ là đề xuất, không được giả định đã tồn tại.
7. **Không tự triển khai production từ tài liệu.** Commit/push, migration remote, deploy Worker và phát hành APK là các bước riêng, cần quyền đã được anh cấp cho lần thực hiện đó. Tài liệu này không tự cấp quyền cho các bước ấy.
8. **Kiểm chứng phải chạy vào mã thật.** Fixture cố định, kiểm thử trước sửa thất bại và sau sửa đạt; test không được chép lại thuật toán để tự đối chiếu với chính nó.

## 3. Danh mục 26 yêu cầu

| ID | Vấn đề | Ưu tiên | Đợt thực hiện |
| --- | --- | --- | --- |
| V2-01 | Xác thực, quyền truy cập và nhận diện chủ dữ liệu | P1 | 1 |
| V2-02 | Ghi sổ nguyên tử, chống lặp, sửa tiền và xử lý đồng thời | P1 | 2 |
| V2-03 | Nhận diện đúng tài khoản ngân hàng | P1 | 3 |
| V2-04 | Parser nhận đúng số tiền và dấu tiền vào/ra | P1 | 3 |
| V2-05 | Thời gian chuẩn và bóc tách lại giữ thời gian gốc | P1 | 3 |
| V2-06 | Hàng đợi Android bền vững, gửi bù và retry đúng | P1 | 3 |
| V2-07 | Frontend lưu dữ liệu và xử lý lỗi có xác nhận | P1 | 4 |
| V2-08 | Bảo toàn đầy đủ thông tin tài khoản và QR | P1 | 1 |
| V2-09 | Reset đúng phạm vi, không tự sinh lại dữ liệu mẫu | P1 | 2 |
| V2-10 | Ghép/tách chuyển nội bộ đúng bản chất và trạng thái | P1 | 2, 3 |
| V2-11 | Lưu trữ tài khoản có lịch sử, tránh giao dịch mồ côi | P1 | 2 |
| V2-12 | Phân loại nguồn thu duy nhất, tổng các nhóm bằng tổng thu | P1 | 5 |
| V2-13 | Tổng chi bao gồm khoản chưa gắn hũ | P1 | 5 |
| V2-14 | Báo cáo đầy đủ và phân trang lịch sử | P1 | 5 |
| V2-15 | Kỳ tổng/chi tiết và mẫu số KPI thống nhất | P1 | 5 |
| V2-16 | Kế hoạch theo lịch và có phiên bản hiệu lực | P2 | 6 |
| V2-17 | Phân bổ VND chính xác và tổng tỷ lệ hợp lệ | P2 | 5 |
| V2-18 | Đúng nguồn giá, sản phẩm và đơn vị tài sản | P1 | 7 |
| V2-19 | Lãi/lỗ đầu tư có định nghĩa rõ; XIRR đủ dữ liệu | P2 | 7, 10 |
| V2-20 | Lối tắt đúng loại giao dịch, khởi tạo form nhất quán | P1 | 4 |
| V2-21 | Giao diện gọn, chữ dễ đọc, vùng chạm thuận tiện | P2 | 8 |
| V2-22 | Modal, Back, focus, zoom và thao tác vuốt | P2 | 8 |
| V2-23 | Chế độ riêng tư phủ kín dữ liệu nhạy cảm | P2 | 8 |
| V2-24 | Biểu đồ đúng ý nghĩa và đúng tỷ trọng | P2 | 8 |
| V2-25 | Nhập/sửa ngày, tiền, tài khoản; tìm và lọc lịch sử | P2 | 4, 8 |
| V2-26 | Trạng thái kết nối thật, đồng bộ và sao lưu đầy đủ | P1/P2 | 4, 9 |

P1: ảnh hưởng dữ liệu, số tiền hoặc khả năng hoàn thành luồng chính. P2: cải thiện độ rõ ràng, tính năng và khả năng sử dụng. Đợt 0 chuẩn bị dữ liệu/test; đợt 10 là mở rộng XIRR riêng, không cản việc sửa an toàn phần cốt lõi.

## 4. Hợp đồng dữ liệu dùng chung

Các kiểu sau là **đề xuất cần bổ sung**, không phải API hiện có.

### 4.1. Tiền, ngày và ID

| Trường | Quy tắc |
| --- | --- |
| `amountVnd` | Số nguyên an toàn, hữu hạn, lớn hơn 0 cho giao dịch thu/chi/chuyển |
| `balanceVnd` | Số nguyên có dấu; không tự ép số dư âm về 0 |
| `quantityDecimal`, `priceVndDecimal` | Chuỗi thập phân đã chuẩn hóa; dùng số học thập phân khi nhân/chia |
| `occurredAt` | ISO UTC có hậu tố `Z`, chuẩn hóa tại biên API |
| `receivedAt` | Thời điểm server nhận, khác với thời điểm xảy ra giao dịch |
| `localDate` | Ngày lịch `YYYY-MM-DD` trong múi giờ Việt Nam cho kỳ kế hoạch |
| `accountId`, `jarId`, `incomeSourceId` | Khóa liên kết; tên/code chỉ phục vụ hiển thị hoặc gợi ý |
| `revision` | Số nguyên tăng sau mỗi mutation thành công của entity |
| `operationId` | ID bền vững của lần thao tác; giữ nguyên khi retry |

Validation backend phải chặn `NaN`, vô cực, tràn số an toàn, số tiền âm/0, enum không hợp lệ, ngày không parse được và ID không thuộc user. Không dùng `body.amount || 0` thay cho kiểm tra đầu vào.

Đối với dữ liệu ngân hàng có phần thập phân: parser phải xác định đúng định dạng trước, rồi áp dụng quy tắc làm tròn VND đã công bố. API giao dịch mới nhận giá trị nguyên chuẩn; không âm thầm xóa mọi dấu phân cách của chuỗi không hiểu được. Không làm tròn NAV/đơn giá trước khi nhân số lượng.

### 4.2. Kỳ thống kê

```ts
type PeriodContext = {
  mode: 'month' | 'quarter' | 'year' | 'custom' | 'all';
  timeZone: 'Asia/Ho_Chi_Minh';
  fromInclusiveUtc: string | null;
  toExclusiveUtc: string | null;
  label: string;
};
```

- Mọi khoảng hữu hạn dùng `[from, to)`: bao gồm đầu kỳ, loại trừ đầu kỳ kế tiếp.
- Tính ranh giới từ lịch Việt Nam rồi đổi sang UTC đúng một lần. Không cộng `+7h` chồng lên một `Date` đã được dịch trước đó.
- Ví dụ tháng 12/2026: từ `2026-11-30T17:00:00.000Z` đến trước `2026-12-31T17:00:00.000Z`.
- Query ngày dùng cột thời gian đã chuẩn hóa và index; không để mỗi màn hình tự quyết định offset riêng.
- `all` có thể không có ranh giới, nhưng không được sử dụng chỉ tiêu một tháng làm mẫu số.

### 4.3. Kết quả mutation

```ts
type MutationAck = {
  operationId: string;
  applied: boolean;
  replayed: boolean;
  entityIds: string[];
  revisions: Record<string, number>;
  dataRevision: number;
};
```

Response thành công phải đi sau commit dữ liệu. `applied` không được suy ra chỉ từ HTTP 200 của một bước trung gian. Lỗi trả mã máy đọc được và thông báo tiếng Việt: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `ACCOUNT_NOT_FOUND`, `RETRYABLE_ERROR`.

## 5. Phương án sửa logic và dữ liệu

### V2-01 — Xác thực phù hợp cho Web/PWA và Android

**Vị trí hiện tại:** middleware và các route trong `backend/src/index.ts`; URL gọi API ở `frontend/src/App.tsx`, `SettingsModal.tsx`, `ResetModal.tsx`; Kotlin listener và WebView.

**Phương án đề xuất:** giữ hệ thống cá nhân của anh, thêm xác thực chủ tài khoản và quyền riêng cho từng thiết bị gửi thông báo; chưa cần xây hệ thống nhiều người dùng phức tạp.

1. Web/PWA đăng nhập qua một nhà cung cấp danh tính; có thể dùng Cloudflare Access với danh sách email được phép. Worker phải xác minh chữ ký, issuer, audience và thời hạn JWT, không tin header email do client tự gửi. Nếu dùng cookie cho mutation, kiểm tra Origin và cơ chế chống CSRF.
2. Ưu tiên frontend gọi `/api` cùng origin qua Worker gateway/service binding để giảm rắc rối cookie/CORS; route API gốc vẫn phải kiểm tra danh tính hoặc chỉ nhận lưu lượng nội bộ hợp lệ. CORS allowlist là lớp bổ sung, không phải xác thực.
3. User được xác định phía server. Có thể ánh xạ chủ tài khoản đã xác minh vào ID `user_default` đang tồn tại để tránh chuyển toàn bộ dữ liệu ngay; bỏ quyền chọn `userId` tùy ý từ payload. Mọi lookup/update/delete kiểm tra `user_id`.
4. Android listener dùng credential **riêng từng thiết bị**, scope chỉ `notifications:ingest`. Đề xuất flow ghép thiết bị: chủ tài khoản đăng nhập tạo mã một lần, hết hạn nhanh; app đổi mã lấy credential; server lưu hash credential và trạng thái thu hồi trong D1. Không nhúng secret dùng chung vào APK hoặc bundle web.
5. Credential Android lưu bằng cơ chế được Android Keystore bảo vệ; không expose token qua JavaScript bridge. Thu hồi thiết bị chặn lần gửi sau; 401 làm queue tạm dừng và yêu cầu ghép lại, không xóa notification.
6. Bảo vệ cả logs, analytics, profile, export, seed, reset và APK proxy nếu chúng thuộc phạm vi riêng tư. Health công khai chỉ trả thông tin tối thiểu. Route seed/demo chỉ cho thao tác quản trị được xác nhận.
7. Khi bổ sung bridge, giới hạn WebView vào origin HTTPS của app; link ngoài mở trình duyệt; không cho nội dung không tin cậy dùng bridge. Quyền đăng nhập/gửi thông báo phải được kiểm thử trên cả WebView và trình duyệt.

Cloudflare yêu cầu ứng dụng kiểm tra tính hợp lệ của token origin, không chỉ sự có mặt của header: [Access application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/). Hướng dẫn bridge: [Android WebView security](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges).

**Nghiệm thu:** request không credential nhận 401; credential của thiết bị gọi reset nhận 403; sửa `userId` không đổi chủ dữ liệu; mã ghép dùng lại/hết hạn bị từ chối; credential bị thu hồi không gửi được; không khóa mất đường đăng nhập của chủ tài khoản.

### V2-02 — Một dịch vụ ghi sổ, mutation nguyên tử và chống lặp

**Vị trí hiện tại:** `PUT/POST/DELETE /api/transactions`, `/unpair`, `/pair-transfer`; cập nhật số dư trong `App.tsx`.

**Module đề xuất:** `backend/src/services/ledger.ts`, `mutationService.ts`, `validation.ts`; migration cho receipt, posting, revision và soft delete.

**Quy tắc toán học:** định nghĩa đóng góp của một giao dịch `C(txn, account)`:

| Trạng thái/loại | Tài khoản nguồn | Tài khoản đích |
| --- | ---: | ---: |
| Pending, rejected, paired_hidden hoặc đã xóa | 0 | 0 |
| Confirmed income | `+amount` | 0 |
| Confirmed expense | `-amount` | 0 |
| Confirmed transfer chính | `-amount` | `+amount` |

Với mọi sửa đổi, dùng `delta(account) = C(new, account) - C(old, account)`. Với nhóm ghép/tách, lấy tổng đóng góp của **tất cả bản ghi liên quan** trước và sau. Nhờ đó sửa tiền, đổi loại, đổi tài khoản, hoàn tác và xóa dùng cùng một phép tính.

**Cơ chế D1 đề xuất:**

1. Đọc trạng thái cũ để tính delta; client gửi `expectedRevision` và `operationId`. Đọc trước không được xem là khóa dữ liệu.
2. Một `DB.batch()` chứa receipt chống lặp, kiểm tra điều kiện revision/quyền/trạng thái, cập nhật giao dịch, ghi posting và cộng delta tài khoản. Không chia chúng thành các request DB độc lập.
3. Kiểm tra revision phải có hiệu lực **bên trong batch** và làm batch thất bại khi không khớp. Phương án mặc định: receipt có `CHECK(preconditions_ok = 1)`; một `INSERT ... SELECT` không có outer FROM/WHERE luôn cố tạo **đúng một row**, tính `preconditions_ok` bằng CASE với scalar subquery/EXISTS ngay trong DB. Missing/stale/sai quyền phải thành giá trị 0 để CHECK abort. Không bind giá trị true do Worker tự tính; CHECK chỉ kiểm tra cột được chèn, không đặt subquery trực tiếp trong định nghĩa CHECK. Pair phải kiểm tra cả hai leg, group revision, ownership và trạng thái tài khoản trong điều kiện này.
4. Cấm kiểu conditional insert `INSERT ... SELECT ... FROM transactions WHERE precondition` có thể trả 0 row mà không lỗi; cũng không coi `UPDATE ... WHERE revision = ?` thay đổi 0 dòng là lỗi SQL tự động. Mọi UPDATE/posting ràng buộc với receipt thành công của đúng operation. Có assertion cuối batch luôn tạo một row với `CHECK(ok = 1)` để kiểm tra revision/trạng thái/số posting và delta kỳ vọng sau mutation; sai thì rollback. Có thể dùng trigger tương đương nếu prototype D1 chứng minh cùng bất biến, nhưng phải chốt một cơ chế cho toàn hệ thống.
5. `mutation_receipts` có unique `(user_id, operation_id)`, hash payload chuẩn và ACK/entity/revision kết quả đủ để replay. Trước khi mutate, lookup receipt: cùng ID/cùng hash trả ACK đã lưu; cùng ID/khác hash trả 409. Nếu lúc lookup chưa thấy nhưng batch lỗi do race hoặc guard stale, đọc lại receipt theo cùng user/operationId rồi áp dụng quy tắc đó; chỉ khi chưa có receipt mới trả conflict/lỗi tương ứng. Việc này tránh replay hợp lệ bị CHECK revision mới đánh nhầm là xung đột. Không tự cấp operationId mới khi retry.
6. `ledger_postings` lưu `operation_id`, tài khoản, giao dịch/nhóm, delta VND và thời gian; bất biến sau commit. `accounts.balance` là số dư materialized, cập nhật cùng batch. Kiểm tra tài khoản tồn tại/đúng user. Giao dịch mới cần tài khoản hoạt động; correction delta của lịch sử trên tài khoản lưu trữ được phép theo quyền và snapshot cũ, kể cả sửa amount, đổi nguồn và unpair; không chỉ cho reversal thuần. Không dùng correction để tạo khoản mới vào tài khoản lưu trữ.
7. Đổi số dư thủ công tạo **balance adjustment có audit**, dùng account revision; không giả thành income/expense và không ghi đè từ một form cũ. Cho phép số dư âm khi hợp lệ, không tự chặn khoản chi chỉ vì số dư khai báo chưa đầy đủ.
8. DELETE nghiệp vụ chuyển sang soft delete và reversal. Gọi bằng ID chân ẩn phải quy về nhóm chính, kiểm tra cả nhóm và không được bỏ qua việc hoàn số dư.
9. `balanceAfter` là số dư ngân hàng quan sát được, dùng đối chiếu. Nếu chênh với sổ, hiển thị đề nghị điều chỉnh có xác nhận; không vừa áp delta vừa overwrite balance.

`DB.batch()` có cơ chế transaction/rollback khi câu SQL thất bại; đó không phải bằng chứng rằng mọi điều kiện nghiệp vụ đã được kiểm tra: [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/). Cách claim/guard là thiết kế riêng của dự án, phải có test cạnh tranh trên D1 local và staging.

Nếu bật read replication, lookup/re-read receipt phải dùng đường đọc primary hoặc session có bảo đảm đọc phù hợp, không nhận replica stale làm căn cứ kết luận chưa có operation. Hash payload bỏ metadata retry thay đổi theo lần gửi nhưng giữ toàn bộ ý định nghiệp vụ và expected revision ban đầu.

**Chuyển sổ cũ:** chốt số dư từng tài khoản tại thời điểm cutover và lưu mốc baseline. Posting mới chỉ áp từ mốc này. Giữ lịch sử cũ để báo cáo; không replay toàn bộ giao dịch cũ lên số dư đã bao gồm chúng. Trạng thái cân đối ban đầu cần đối soát trên bản sao dữ liệu trước.

**Nghiệm thu:** 20 yêu cầu duyệt đồng thời chỉ tạo một lần tác động; chuyển 2 triệu trừ/cộng đủ hai đầu và tổng tiền không đổi; sửa chi 100 nghìn thành 200 nghìn chỉ trừ thêm 100 nghìn; đổi tài khoản hoàn nguồn cũ và trừ nguồn mới; lỗi giữa batch không để lại receipt/posting/số dư nửa chừng; undo/delete retry không hoàn tiền hai lần.

### V2-03 — Nhận diện tài khoản không dùng OR rồi lấy dòng đầu

**Vị trí:** tìm tài khoản trong ingest và reprocess; thông tin bank code trong `vietnamBanks.ts`.

- Chuẩn hóa mã ngân hàng qua bảng alias dùng chung: ví dụ `VPBank/VPB`, `TPBank/TPB`, `HDBank/HDB`, `VietinBank/ICB`. Không đổi ID tài khoản vì đổi tên ngân hàng.
- Thứ tự: khớp số tài khoản đầy đủ + ngân hàng; nếu không có thì khớp ngân hàng + số đuôi; nếu chỉ biết ngân hàng thì chỉ nhận khi đúng một ứng viên phù hợp.
- Số đuôi giống nhau hoặc nhiều tài khoản cùng ngân hàng phải là `needs_account_review`, không gán tùy ý. Không tạo tài khoản mới chỉ vì chưa thống nhất alias.
- Cho phép xem/sửa tài khoản nhận diện trước duyệt; lưu mapping người dùng đã xác nhận. Không học quy tắc mơ hồ từ tên chứa một chuỗi ngắn.
- Tài khoản mới do thông báo phát hiện có số dư chưa được đối soát; không suy đoán số dư thật từ một pending transaction rồi coi là số dư đã xác nhận.

**Nghiệm thu:** hai VCB đuôi `1111`/`2222`, thông báo `2222` chỉ vào tài khoản thứ hai; cùng đuôi ở hai ngân hàng không nhầm; notification thiếu mask và nhiều ứng viên buộc chọn.

### V2-04 — Parser theo cấu trúc số tiền, có kết quả mơ hồ

**Vị trí:** `backend/src/services/parser.ts`, `dedupe.ts`, `rules.ts`.

1. Giữ raw text để truy vết; tạo bản normalized riêng, chuẩn hóa Unicode minus `−`, các khoảng trắng và Unicode số nếu có.
2. Loại OTP trước khi lưu raw notification, ở cả Android và backend; không chỉ lọc sau khi raw đã được ghi. Không đưa OTP hoặc nội dung tài chính đầy đủ vào log production.
3. Tách ứng viên theo vùng: trường biến động, số dư, tài khoản, thời gian, mã tham chiếu và nội dung. Regex tiền phải gắn dấu/nhãn/đơn vị hợp lệ; dấu `-` giữa các chữ số của ngày không được hiểu là chiều chi.
4. Thứ tự parser theo mẫu ngân hàng đã có fixture; generic parser chỉ nhận khi có một kết quả nhất quán. Nhiều số tiền mâu thuẫn trả `ambiguous`, không tự chọn ứng viên đầu tiên với confidence cao.
5. Phân biệt `150,000.00`, `150.000,00`, `150000`, ký hiệu VND; nhận `balanceAfter = 0`. Không parse số đuôi tài khoản, ngày hoặc externalRef thành amount.
6. Trả `parserVersion`, `parseStatus`, `reasonCode`, các trường đã trích xuất và mức tin cậy có căn cứ. Mẫu chưa rõ có thể vào mục cần kiểm tra, chưa tạo giao dịch confirmed.
7. Transport dedupe dựa event ID của thiết bị; semantic dedupe giữa app/SMS dùng ngân hàng/tài khoản/thời gian/số tiền/reference/balance phù hợp. Không gộp chắc chắn chỉ vì cùng tiền và cùng một ô thời gian 5 phút; ứng viên trùng chưa đủ chứng cứ cần xem lại.

**Fixture bắt buộc:** chuỗi `TK 12345678 thanh toán 150,000 VND ngày 08-11-2026. So du: 2,000,000 VND` phải ra chi `150000`; Unicode `−85,000 VND` ra `85000`; số dư 0 vẫn được giữ; OTP không được lưu; hai giao dịch hợp lệ cùng số tiền không bị loại nhầm.

### V2-05 — Chuẩn thời gian và reprocess không đổi lịch sử

- API chấp nhận có kiểm soát ISO hoặc epoch milliseconds từ Android, chuyển ngay sang ISO UTC. Epoch seconds không được đoán tùy ý: chỉ nhận khi payload khai báo đúng đơn vị/schema.
- Lưu riêng `occurred_at`, `received_at`, `time_source`, `original_time_value`; ngày từ nội dung chỉ dùng nếu mẫu ngân hàng xác định được timezone và ngày/tháng/năm không mơ hồ.
- Raw notification cần lưu thời điểm gốc từ thiết bị. Reprocess đọc đúng `user_id` và thời gian của từng raw record, không gán toàn bộ về `user_default` hoặc `now`.
- Migration nhận diện các giá trị milliseconds cũ theo kiểu/range có kiểm soát; giữ original và run ID; bản ghi không xác định được đưa vào danh sách cần xử lý, không tự gán hôm nay.
- Reprocess có event ID/unique liên kết raw-to-transaction, không tạo thêm giao dịch mỗi lần nâng parser. Nếu raw đã tạo giao dịch confirmed, chỉ đề xuất thay đổi; sửa thực sự phải đi qua ledger service.

**Nghiệm thu:** giao dịch lúc 01:30 ngày 01/12 giờ VN thuộc tháng 12; gửi bù/reprocess sau hai ngày vẫn giữ kỳ cũ; chạy reprocess hai lần không tăng số lượng giao dịch.

### V2-06 — Queue Android lưu trước, gửi sau

**Module đề xuất:** bảng Room notification outbox, repository queue và WorkManager worker. `SharedPreferences` cũ chỉ dùng làm đầu vào migration queue.

1. Khi nhận notification hợp lệ, tạo event ID một lần và lưu queue bền vững trước khi gọi mạng. Row gồm payload, occurredAt, attempts, nextAttemptAt, state và lỗi cuối.
2. Worker có ràng buộc mạng, nhận việc unique và thao tác claim row tuần tự. Kích hoạt khi enqueue, khi app resume và theo lịch phục hồi của WorkManager; không phụ thuộc có notification mới.
3. Timeout sau khi server đã commit vẫn gửi lại cùng event ID. Server trả ACK duplicate như thành công; chỉ xóa/đánh dấu hoàn tất sau ACK hợp lệ.
4. Timeout/5xx/429 retry với backoff, tôn trọng `Retry-After`; 401/403 dừng chờ xử lý quyền, giữ dữ liệu. Lỗi validation chuyển hàng lỗi để xem, không retry vô hạn.
5. Thông báo không parse được nhưng đã lưu thành công có thể được ACK với `accepted_for_review`; phân biệt tiếp nhận payload với parse thành giao dịch. Không trả một 400 chung làm client hiểu mọi tình huống đều nên gửi lại.
6. Định nghĩa dung lượng/retention bằng số bản ghi và byte; đầy queue phải cảnh báo rõ, không âm thầm xóa notification chưa gửi. Payload nhạy cảm được bảo vệ trên thiết bị.
7. Chuyển queue cũ theo một migration marker: import xong, kiểm tra số lượng rồi mới bỏ dữ liệu cũ; restart giữa migration không import lặp.

WorkManager hỗ trợ công việc bền vững và retry/backoff theo điều kiện: [Android persistent work](https://developer.android.com/develop/background-work/background-tasks/persistent), [define work requests](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work). Không hứa gửi ngay khi hệ điều hành đang trì hoãn tác vụ.

**Nghiệm thu:** mất mạng, tắt process, reboot rồi có mạng vẫn gửi đủ; server commit nhưng client timeout không nhân đôi; payload lỗi không khóa các payload tốt phía sau; thu hồi credential giữ queue và yêu cầu ghép lại.

### V2-07 — Một tầng API và trạng thái lưu minh bạch

**Module đề xuất:** `frontend/src/services/apiClient.ts`, `mutationOutbox.ts`, `queryStore.ts` hoặc giải pháp tương đương phù hợp React hiện có.

- Tập trung API base URL, auth, kiểm tra HTTP/schema response, timeout và ánh xạ lỗi. Không để từng component tự fetch rồi luôn toast thành công.
- Với thao tác tài chính, ưu tiên chờ ACK rồi áp bản canonical. Nếu optimistic UI cần thiết, giữ snapshot/operationId và nhãn `Đang lưu`; lỗi phải rollback hoặc chuyển `Chưa đồng bộ`, không giả confirmed.
- Giao dịch thủ công offline lưu IndexedDB outbox với ID bền vững; bản nháp nằm ngoài báo cáo đã ghi sổ. Retry sau mạng/đăng nhập; 409 phải cho xử lý xung đột. Không tự replay reset/xóa hàng loạt sau một thời gian dài offline.
- Undo cũng là mutation được xếp sau ACK của thao tác gốc. Không cho hai request confirm/undo vượt nhau làm trạng thái server đảo ngược ý định cuối của người dùng.
- Reload merge theo ID, revision và operation state; không dùng dữ liệu tải về để xóa bản nháp chưa gửi. Cache theo chủ tài khoản; logout xử lý cache/outbox có cảnh báo với bản chưa gửi.
- Sau mutation thành công, invalidation đầy đủ: tài khoản, pending/history, summary, source/jar detail và snapshot liên quan. Cache tổng không phụ thuộc riêng vào số lượng giao dịch.

**Nghiệm thu:** 400/500/network timeout không hiện `Đã lưu`; draft tồn tại sau đóng/mở; retry không nhân bản; hai thiết bị sửa cùng revision nhận 409; undo trên mạng chậm cho kết quả cuối là pending cả server và UI.

### V2-08 — Tài khoản đầy đủ và QR đúng

- `mapAccount` phải giữ tất cả trường trong `BankAccount`, hỗ trợ cả snake_case/camelCase có kiểm tra; cache cũng giữ cùng schema.
- Phân biệt `accountNumber` đầy đủ với `accountNumberMask`; không điền `*6789` vào input rồi strip thành số tài khoản thật `6789` khi lưu.
- PATCH có ba trạng thái: bỏ qua trường = giữ nguyên; giá trị hợp lệ = cập nhật; `null` = xóa rõ ràng nếu trường cho phép. Không xóa dữ liệu bằng `undefined` ngoài ý định người dùng.
- Không tạo QR từ mask hoặc số tài khoản thiếu. Hiện lời mời bổ sung số đầy đủ; chỉ bật QR khi ngân hàng/BIN và số tài khoản đủ điều kiện.
- Ngân hàng/BIN dùng danh mục canonical; sao chép thông tin và QR lấy cùng account entity. Lỗi clipboard/download có thông báo và phương án thao tác thay thế, không báo đã chép khi thất bại.

**Nghiệm thu:** thêm đủ số/chủ/chi nhánh, reload, sửa riêng tên gợi nhớ rồi reload lần nữa vẫn giữ đủ trường; tài khoản chỉ có mask không tạo QR; không suy đoán các chữ số đã mất từ dữ liệu cũ.

### V2-09 — Reset tường minh, seed chỉ theo lệnh

| Scope | Thay đổi được phép | Dữ liệu phải giữ |
| --- | --- | --- |
| `income` | Lưu trữ nguồn thu/kế hoạch thu đang hoạt động; tùy chọn xóa liên kết phải được mô tả riêng | Giao dịch, số dư, hũ và kế hoạch chi |
| `planned_expenses` | Kế hoạch chi trong phạm vi được chọn | Thu, giao dịch, số dư |
| `transactions` | Bỏ lịch sử hiển thị theo phương án giữ số dư hoặc hoàn tác, chọn rõ trước xác nhận | Không tự ngầm đổi tài sản/nguồn thu |
| `balances` | Đặt số dư bằng adjustment có audit | Không xóa giao dịch lịch sử |
| `holdings` | Lưu trữ danh mục thuộc user | Không xóa bảng assets chung của người khác |
| `all` | Reset các nhóm đã công bố sau xác nhận mạnh và sao lưu | Audit/receipt quản trị tối thiểu và bản sao lưu độc lập |

- Bỏ seed từ `ensurePlanningTables` và các route GET/ingest. Setup trống là trạng thái hợp lệ; demo là thao tác rõ ràng, không tự khởi tạo lại sau reset.
- Tách **ẩn lịch sử nhưng giữ số dư hiện tại** và **hoàn tác giao dịch về số dư trước đó**. V2 chọn cách giữ số dư bằng cờ `history_hidden_at` riêng cho list/analytics: giữ nguyên baseline cutover và toàn bộ postings, **không tạo baseline mới**. Cờ ẩn không làm thay đổi đóng góp C của giao dịch hoặc sinh reversal; nó khác với `deleted_at`. Cách thứ hai đi qua ledger reversal và soft delete. Không dùng DELETE hàng loạt dưới trigger ledger mà chưa xác định tác động.
- UI gọi đúng “Ẩn lịch sử, giữ số dư”; backup quản trị vẫn chứa dữ liệu ẩn và cờ của chúng. Reset all có thể ẩn lịch sử và đặt balance về 0 bằng adjustment có audit, vẫn giữ một baseline và toàn bộ postings. Nếu sau này muốn thanh lọc vật lý vì retention, cần thiết kế ledger epoch riêng; không đặt lại baseline=currentBalance rồi cộng postings cũ.
- Reset có bước preview: scope, số bản ghi, tổng tiền bị ảnh hưởng và tùy chọn raw logs. Người dùng xác nhận đúng preview revision; dữ liệu đổi giữa preview/execute thì yêu cầu xem lại.
- Bỏ liên hệ reset thu với `monthly_limit = 0` tự động. Nếu anh muốn đặt lại hạn mức hũ, cung cấp lựa chọn độc lập, mặc định không chọn.

**Nghiệm thu:** reset thu không làm mất chi dự kiến/giao dịch/số dư; reload không sinh nguồn mẫu; reset riêng holdings không xóa tài sản ngoài user; hai chế độ xử lý lịch sử cho đúng số dư đã công bố.

### V2-10 — Chuyển nội bộ là nhóm có chứng cứ và lịch sử gốc

- Mặc định gợi ý ghép khi cùng tiền/ngược chiều/trong cửa sổ thời gian, chưa tự đổi thành transfer chỉ dựa ba tiêu chí đó. Auto-pair chỉ bật nếu đủ bằng chứng đã định nghĩa và kiểm thử, như reference đối ứng hoặc tài khoản người dùng đã xác nhận.
- Chọn ứng viên gần nhất chưa đủ nếu nhiều ứng viên hợp lệ; hiển thị để anh chọn hoặc giữ độc lập. Phí chuyển tiền khác amount cần là khoản phí riêng, không ép hai chân lệch tiền thành chuyển bằng nhau.
- Nhóm có canonical primary ID, thành viên và snapshot gốc: type, account, time, source/jar, description. Mọi API nhận ID chân nào cũng xử lý cùng nhóm đúng quyền/revision.
- Chân ẩn có đóng góp sổ bằng 0. Nếu chuyển thủ công chỉ có một thông báo thực, chân phụ synthetic phải được đánh dấu; tách nhóm không được biến chân giả thành thu/chi thật.
- Pair/unpair đổi nhiều trạng thái trong ledger operation nguyên tử. Tách transfer đã duyệt trước hết đảo đóng góp cũ, rồi khôi phục các chân thật về pending để anh xác nhận riêng.
- Chặn ghép lặp, ghép bản đã thuộc nhóm khác, tài khoản giống nhau và sửa nhóm stale. Không đoán original type bằng chuỗi `vao`/`nhận` khi có snapshot gốc.

**Nghiệm thu:** hai khoản độc lập cùng tiền không tự mất khỏi thu/chi; pair/unpair nhiều lần bảo toàn tiền; gọi bằng hidden ID vẫn xử lý chuẩn; synthetic leg không trở thành giao dịch thật sau tách.

### V2-11 — Lưu trữ danh mục có lịch sử

- Tài khoản đã có giao dịch chuyển `is_active = 0`/`archived_at`, không hard delete; vẫn join được lịch sử và có thể reversal. Tài khoản lưu trữ không xuất hiện ở lựa chọn ghi mới.
- Lưu trữ chỉ ẩn khỏi luồng ghi mới, không tự biến tiền còn sở hữu thành 0. Nếu tài khoản còn số dư, phải tiếp tục tính vào tổng tài sản hoặc yêu cầu chuyển/điều chỉnh có ghi sổ trước khi loại khỏi cơ cấu tài sản. API cần phân biệt `archived` với `includeInAssets` thay vì lọc mù mọi `is_active = 0`.
- Tài khoản không lịch sử chỉ được hard delete theo đường quản trị rõ ràng. Không cascade xóa giao dịch tài chính để cho phép xóa tài khoản.
- Nguồn thu/hũ có lịch sử ưu tiên archive. Nếu thật sự xóa quan hệ, phải chuyển các giao dịch sang nhóm chưa phân loại trong cùng operation, giữ tên/ID lịch sử để truy vết.
- Migration phát hiện ID mồ côi có sẵn, tạo danh sách đối soát; không tự suy đoán tài khoản thật từ tên gần đúng và không replay tiền để chữa dữ liệu mồ côi.

**Nghiệm thu:** archive tài khoản vẫn thấy đúng tên trong lịch sử; không ghi mới vào tài khoản archive; undo giao dịch cũ vẫn hoàn đúng; báo cáo tổng tiền không giảm vì xóa danh mục.

## 6. Phương án chuẩn hóa công thức và báo cáo

### V2-12 — Mỗi khoản thu thuộc đúng một nhóm

**Vị trí:** `DashboardView.tsx` phần `incomeSourceComparison`; `BudgetView.tsx`; `IncomeSourceDetailModal.tsx`; SQL analytics.

Hợp đồng phân loại duy nhất:

| Điều kiện | Nhóm trả về |
| --- | --- |
| Không phải confirmed income, đã xóa/chân ẩn hoặc lịch sử được ẩn theo scope báo cáo | `excluded` khỏi analytics; cờ ẩn lịch sử không đổi đóng góp ledger |
| Có source ID tồn tại, đúng user, kể cả nguồn đã archive | `assigned(sourceId)` |
| ID là null và người dùng chưa gán | `unassigned` |
| ID tồn tại trên giao dịch nhưng không tìm được nguồn hợp lệ | `orphaned(originalId)` |

- Có ID rồi thì không dò tên để cộng thêm vào nguồn khác. Đổi tên nguồn không chuyển tiền giữa các nhóm.
- Legacy không có ID mặc định ở `unassigned`. Có thể chạy công cụ **đề xuất** mapping theo tên/từ khóa, nhưng người dùng phải xem và xác nhận; giữ original và audit. Không tự ghi quan hệ chỉ vì `description.includes(name)`.
- Tất cả card, modal, export, bộ lọc và backend summary dùng đúng contract. Không để frontend fallback theo tên còn SQL chỉ group ID.
- Invariant: `totalIncome = sum(assigned) + unassigned + orphaned`; mỗi giao dịch được đếm đúng một lần.
- Nguồn archive có giao dịch trong kỳ vẫn xuất hiện trong chi tiết lịch sử; nguồn hoàn toàn chưa phát sinh có thể thu gọn, không loại giao dịch của chúng khỏi tổng.

**Fixture:** một khoản 10 triệu gán `id=luong_chinh`, hai nguồn tên “Lương” và “Lương chính” => tổng 10 triệu, chỉ nhóm `luong_chinh` có tiền. Khoản legacy chưa ID và khoản quà tặng đều ở nhóm chưa gán cho đến khi anh xác nhận mapping; card và modal có cùng tổng/count.

### V2-13 — Tổng chi độc lập với danh sách hũ

- Tính `totalExpense` trực tiếp từ toàn bộ confirmed expense hợp lệ trong kỳ. Bảng hũ là phân rã của tổng, không phải nguồn tính tổng.
- Phân nhóm bằng `jarId`; thiếu ID => “Chi chưa phân loại”; ID mồ côi => “Hũ cần đối soát”. Không tự fallback về NEC khi chỉ vì JOIN không tìm thấy hũ.
- Tỷ trọng hũ dùng mẫu số **tổng chi**, có cả nhóm chưa phân loại. Nếu biểu đồ chỉ hiện các hũ đã gán, phải ghi rõ tỷ lệ được phân loại và phần chưa gán.
- Archive/đổi tên hũ không đổi tổng chi lịch sử. Khi chọn lại hũ, chỉ quan hệ phân loại thay đổi; số dư tài khoản giữ nguyên.

**Nghiệm thu:** chi 300 nghìn có hũ + 200 nghìn chưa hũ => tổng chi 500 nghìn, nhóm tương ứng 60%/40%; archive hũ vẫn giữ tổng và danh tính lịch sử.

### V2-14 — Analytics trên server, lịch sử phân trang

**Endpoint hiện có cần nâng cấp:** `GET /api/analytics/summary`, `GET /api/transactions`. Bổ sung bộ lọc và metadata; không tạo API tổng hợp song song với định nghĩa khác.

Response summary đề xuất:

```ts
type FinanceSummary = {
  range: PeriodContext;
  dataRevision: number;
  planRevision: number;
  totalIncomeVnd: number;
  totalExpenseVnd: number;
  incomeBuckets: Array<{
    kind: 'assigned' | 'unassigned' | 'orphaned';
    sourceId: string | null; originalSourceId?: string;
    amountVnd: number; count: number;
  }>;
  expenseBuckets: Array<{
    kind: 'assigned' | 'unassigned' | 'orphaned';
    jarId: string | null; originalJarId?: string;
    amountVnd: number; count: number;
  }>;
  complete: true;
  generatedAt: string;
};
```

1. Server aggregate đầy đủ với filter range/user/status thống nhất cho mọi kỳ. Bỏ điều kiện frontend `confirmedTransactions.length >= 450` và mọi phép lấy max giữa local/server.
2. Danh sách giao dịch dùng cursor theo `(occurred_at DESC, id DESC)` với filter cùng range/classification/account/type/search. Response có `items`, `nextCursor`, `totalCount`, `totalAmountVnd`, range và revision.
3. Snapshot dùng cặp `(dataRevision, planRevision)`. Summary và detail có KPI mở từ nó echo cùng cặp này; cursor/query token và cache key mang cả hai revision khi kết quả phụ thuộc kế hoạch. Nếu dữ liệu hoặc kế hoạch đổi trong khi phân trang/xem KPI, trả tín hiệu stale/409 để tải lại hoặc dùng snapshot thực sự được kiểm chứng; không hứa cursor đơn thuần tạo được snapshot bất biến.
4. Khi mất mạng, hiện bản summary cache cuối cùng cùng thời điểm và nhãn chưa cập nhật. Nếu chỉ có vài trang local thì không gọi đó là tổng kỳ đầy đủ; có thể hiện tổng phần đã tải với nhãn riêng.
5. Cache key gồm user, range, filter, dataRevision và planRevision khi có kế hoạch. Chỉnh tiền/hũ/nguồn với số lượng giao dịch không đổi vẫn invalidation; chỉ sửa kế hoạch, không đổi count/dataRevision, vẫn làm mới KPI và detail expected.
6. Index đề xuất sau khi đo query: `(user_id, status, occurred_at, id)`, thêm source/jar/account theo truy vấn thật. Không tăng limit lên hàng chục nghìn để thay việc phân trang.

**Nghiệm thu:** bộ dữ liệu trên 1.200 giao dịch, gồm nhiều pending; tổng tháng/quý/năm bằng SQL đầy đủ; cộng mọi trang detail bằng summary; sửa giao dịch vẫn cùng count cập nhật lại KPI; không trùng/mất bản ghi khi tải tiếp.

### V2-15 — Một kỳ xuyên suốt card, modal và KPI

- Truyền `PeriodContext` và bucket filter từ Dashboard/Budget vào chi tiết hũ/nguồn. Lần mở mới lấy kỳ của màn hình cha; không giữ tháng cũ trong state từ lần mở trước.
- Header modal ghi đúng “Tháng 9/2026”, “Quý 3/2026” hoặc “Tất cả thời gian”. Tổng, count, danh sách và export trong modal cùng kỳ.
- Với khoảng hữu hạn: `achievementPct = actual / expectedForRange * 100` khi expected > 0. Hiển thị phần trăm thật nếu vượt 100%; thanh progress có thể giới hạn chiều dài 100% nhưng nhãn vẫn đúng.
- Với “Tất cả thời gian” không có kế hoạch lịch sử đầy đủ: chỉ hiển thị tổng/count, ẩn KPI đạt dự kiến và hạn mức tháng. Không lấy tổng 3 tháng chia chỉ tiêu một tháng.
- Expected bằng 0: hiện “Chưa đặt kế hoạch” hoặc “Theo thực tế”; không hiện 0%, vô cực hoặc coi kế hoạch bằng 0 là đã đạt 100%.
- Ngân sách có thể mặc định tháng hiện tại nhưng phải hiển thị năm và có điều hướng kỳ nhất quán với Tổng quan.

**Nghiệm thu:** Dashboard tháng 9 có thu 10 triệu, tháng 11 không có thu => bấm chi tiết tháng 9 vẫn thấy 10 triệu; quý có 30 triệu trên kế hoạch 30 triệu => 100%; all-time không xuất hiện KPI 300% trên kế hoạch tháng 10 triệu.

### V2-16 — Kế hoạch có lịch hiệu lực, tách bình quân ngân sách và lịch tiền thực

**Quyết định đề xuất để giữ cách dùng hiện tại:** báo cáo Ngân sách mặc định so với **kế hoạch bình quân tháng** cho khoản định kỳ; phần “Dòng tiền dự kiến theo ngày nhận/chi” là chế độ riêng nếu triển khai. Không âm thầm thay ý nghĩa kế hoạch quý/năm đang được chia đều trong app.

Model đề xuất `plan_versions`:

- ID, user, loại `income/expense/jar_budget`, owner ID và revision.
- `amountVnd`, `cadence` enum `monthly|weekly|quarterly|semiannual|annual|one_time`.
- `effectiveFromMonth`, `effectiveToMonthExclusive`; mặc định thay đổi có hiệu lực từ đầu tháng anh chọn. Không có hai version chồng hiệu lực của một kế hoạch.
- `oneTimeDate` cho khoản một lần; `anchorDate`/ngày đến hạn phục vụ chế độ lịch tiền nếu có.
- Dữ liệu mô tả như tên, note và tình trạng archive; giữ version được dùng trong báo cáo lịch sử.

**Công thức ngân sách:**

| Chu kỳ | Bình quân tháng |
| --- | ---: |
| Tháng | `A` |
| Tuần | `A × 52 / 12`, ghi rõ là bình quân |
| Quý | `A / 3` |
| Nửa năm | `A / 6` |
| Năm | `A / 12` |
| Một lần | Toàn bộ A tại ngày đã chọn; kỳ khác bằng 0 |

- Giữ số hữu tỷ/thập phân trong tính toán; ưu tiên phân bổ phần dư VND theo lịch các tháng của từng chu kỳ gốc bằng largest remainder với thứ tự ổn định. Chỉ tiêu kỳ là tổng các chỉ tiêu tháng/ngày đã phân bổ, để các dòng hiển thị cũng đối soát được với tổng. Nếu có nhãn bình quân đã làm tròn chỉ để tham khảo, phải ghi “xấp xỉ” và không dùng số tham khảo ấy tính KPI. Không nhân 12 từ một giá trị tháng đã làm tròn rồi coi là tổng chính xác năm.
- Kỳ lịch sử lấy từng version có hiệu lực trong các tháng tương ứng. Ví dụ tháng 9 kế hoạch 10 triệu, tháng 10 đổi 15 triệu => tháng 9 vẫn 10 triệu; quý gồm hai version phải tính từng đoạn.
- Khoảng custom cắt giữa tháng: công bố rõ chính sách phân bổ theo số ngày lịch của tháng, làm tròn sau khi cộng toàn kỳ; không đổi số tiền một lần thành phần bình quân theo ngày.
- Nếu có chế độ lịch tiền, tính occurrence theo anchor/cadence và ngày đến hạn; tuần có tháng 4 hoặc 5 lần. Không dùng con số bình quân `52/12` để hứa đúng số tiền sẽ nhận trong một tháng cụ thể.
- Migration chu kỳ string hiện tại sang enum qua bảng mapping. Khoản “Một lần” thiếu ngày cần anh chọn; dữ liệu cũ không đủ kế hoạch lịch sử hiển thị “Chưa có kế hoạch lưu cho kỳ này”, không dựng lịch sử giả.
- Có thể giữ `expectedAmount/recurrence` ở API tương thích một giai đoạn, nhưng chúng chỉ là projection version đang hiệu lực; tránh hai nguồn ghi độc lập.

**Nghiệm thu:** khoản một lần 12 triệu ngày 15/09 chỉ đóng góp 12 triệu ở tháng 9 và năm 2026, không thành 144 triệu; khoản 12 triệu/năm bình quân 1 triệu/tháng và tổng năm đúng 12 triệu; sửa kế hoạch tháng 10 không đổi tháng 9.

### V2-17 — Phân bổ VND và tỷ lệ chính xác

1. Tỷ lệ lưu dưới dạng basis points nguyên: 10.000 điểm = 100%; UI có thể nhận phần trăm với tối đa hai chữ số thập phân.
2. Khi “Chia hũ”, bắt buộc tổng trọng số đúng 10.000, mỗi trọng số không âm và có ít nhất một hũ dương. Tổng khác 100% thì giải thích và mở công cụ cân bằng, chưa ghi hạn mức.
3. Với tổng tiền `T`, tính quota chính xác `T * weight / totalWeight`, lấy floor, rồi phân phối từng đồng còn lại theo phần dư lớn nhất. Khi bằng nhau, dùng thứ tự `sort_order` rồi `id` để kết quả ổn định.
4. Dùng số nguyên/BigInt hoặc decimal ở trung gian để phép nhân không tràn số JS an toàn. Khi trả JSON chuyển về number chỉ sau khi kiểm tra miền hợp lệ.
5. Dùng cùng đặc tả và bộ fixture cho frontend preview/backend commit. Backend là nơi quyết định kết quả; preview không có quyền ghi một bộ hạn mức khác.
6. Tách tỷ trọng “kế hoạch” và “thực tế”; nhóm chưa phân loại vẫn có trong mẫu số thực tế. Không chỉ `Math.round(sum)` để kết luận tổng tỷ lệ hợp lệ.

**Fixture:** `T=1.000.001`, tỷ lệ 33/33/34 => tổng phân bổ đúng `1.000.001`; `T=100.000`, ba trọng số bằng nhau => `33.334/33.333/33.333` theo thứ tự ổn định; tổng 110% bị chặn; T=0 ra toàn 0, không chia cho 0.

### V2-18 — Giá thị trường có danh tính sản phẩm, nguồn và đơn vị

**Vị trí:** `assets/holdings`, `syncAllMarketPrices`, `InvestmentsView.tsx` và form danh mục cũ trong ResetModal.

- Tách `instrumentId/symbol`, `provider`, `providerInstrumentId`, `quoteUnit`, `holdingUnit`, `currency`, `priceAsOf`, `fetchedAt`, `syncStatus`, `autoSync`. Không dùng `assets.source` vừa làm nguồn vừa làm đơn vị.
- SJC/nhẫn trong nước và PAX Gold là các sản phẩm khác nhau. Nếu không có adapter giá SJC đáng tin cậy, giữ chế độ nhập tay mặc định; giá quy đổi PAXG chỉ hiển thị tham khảo với nhãn riêng, không overwrite SJC.
- Danh mục đơn vị có bảng chuyển đổi rõ theo loại tài sản. Ví dụ vàng: gram/chỉ/lượng dựa đơn vị cơ sở đã chốt; `giá mỗi đơn vị nắm giữ = giá mỗi đơn vị báo giá × số đơn vị cơ sở của đơn vị nắm giữ / số đơn vị cơ sở của đơn vị báo giá`. Đơn vị tự nhập không có mapping thì không được bật AutoSync.
- Không cộng các số lượng vàng/bạc khác đơn vị rồi in chung đơn vị của phần tử đầu tiên. Chuẩn hóa về đơn vị chung hoặc hiển thị từng nhóm.
- Giữ decimal của NAV/đơn giá và số lượng đến cuối phép nhân. Giá trị nắm giữ VND = round-half-up(quantity × price), tổng danh mục có quy tắc làm tròn thống nhất.
- Adapter lỗi hoặc upstream không có giá mới: giữ giá cuối, báo `stale/error` và thời điểm nguồn; không đổi `priceAsOf` thành hôm nay chỉ vì đã gọi API. AutoSync của cổ phiếu chỉ được bật nếu có adapter thực sự hỗ trợ mã đó.
- Đổi symbol trong chế độ sửa cần thao tác rename có ID ổn định và kiểm tra trùng; không để một lần “Sửa” vô tình thêm mã mới và giữ mã cũ khiến danh mục nhân đôi.

**Nghiệm thu:** tắt AutoSync SJC giữ nguyên giá tay qua cron; đơn vị gram không nhận giá/chỉ; upstream lỗi không báo cập nhật giá thành công; đổi symbol không nhân đôi tài sản; 10 đơn vị có NAV thập phân dùng đúng tích trước khi làm tròn.

### V2-19 — Phân biệt lãi/lỗ đang nắm giữ, lợi nhuận thực nhận và XIRR

**Sửa bắt buộc trong đợt 7:**

- Gọi chỉ số hiện tại là **lãi/lỗ chưa thực hiện theo giá vốn đang nắm giữ**: `marketValue - remainingCostBasis`. Khi chưa có sổ giao dịch đầu tư đầy đủ, không gọi nó là tổng lợi nhuận thực nhận hoặc XIRR.
- Giá vốn bằng 0: phần trăm trả `null`/“Chưa có giá vốn”; không hiển thị 0% như một kết quả đã đo được.
- Tổng tài sản gồm số dư tài khoản và giá trị holdings; với tài khoản chứng khoán/crypto, trường số dư phải ghi rõ là **tiền chưa đầu tư**, tránh người dùng nhập cả NAV danh mục rồi bị cộng hai lần. Nếu chưa quản lý nợ, không quảng bá chỉ số là tài sản ròng sau nợ.

**Mở rộng đầy đủ trong đợt 10:**

1. Dùng `investment_transactions` hiện có làm nền nhưng bổ sung hợp đồng buy/sell/dividend/fee/tax, ngày, tài khoản và ID nguồn liên kết. Chọn phương pháp giá vốn bình quân gia quyền cho giai đoạn đầu, công bố rõ; chặn bán quá số lượng nếu chưa hỗ trợ bán khống.
2. Buy: chi tiền bằng giá mua × lượng + phí; sell: thu tiền ròng sau phí/thuế, giảm lượng và giá vốn tương ứng. Cổ tức tiền/CP, chia tách cần xử lý riêng; chưa hỗ trợ thì nêu giới hạn, không dựng giao dịch giả.
3. Tiền đầu tư và chuyển tiền nội bộ giữa ví/CK không tự trở thành chi tiêu sinh hoạt. Nếu notification đã ghi một dòng tiền tương ứng, thao tác đầu tư phải liên kết/đối soát thay vì ghi sổ tiền lần hai.
4. XIRR theo phạm vi rõ: toàn danh mục dùng dòng tiền góp/rút bên ngoài và giá trị kết thúc; giao dịch mua/bán bên trong không được tính lặp như góp/rút ngoài. Theo một tài sản dùng các cashflow thuộc tài sản đó với quy tắc công bố riêng.
5. Giải phương trình `sum(CF_i / (1+r)^((date_i-date_0)/365)) = 0`; dòng góp âm, rút/giá trị cuối dương; thời điểm kết thúc nằm đúng ngày định giá. Thiếu hai dấu, thiếu ngày, không hội tụ hoặc nhiều nghiệm không xác định thì hiện “Chưa đủ dữ liệu/Không xác định”, không trả 0% giả.
6. Solver có miền r > -1, sai số residual và số vòng lặp hữu hạn; xác minh bằng fixture độc lập, không chỉ tự gọi lại cùng hàm. Dùng Microsoft XIRR làm đối chiếu quy ước ngày: [XIRR reference](https://support.microsoft.com/en-us/excel/functions/xirr-function).

**Nghiệm thu:** khoản góp -10 triệu ngày 01/01/2025, giá trị cuối +11 triệu ngày 01/01/2026 => gần 10%/năm; phí mua làm tăng giá vốn, phí bán giảm tiền ròng; mua tài sản sau chuyển tiền vào CK không làm giảm tổng tài sản hai lần. Đợt 10 chỉ hoàn tất khi có sổ đầu tư, dòng tiền và fixture đủ chứng cứ; đổi nhãn ở đợt 7 không được coi là đã triển khai XIRR.

## 7. Phương án sửa UI/UX

### V2-20 — Một bộ khởi tạo form cho mọi lối tắt

**Vị trí:** `BudgetView.tsx` cuối file, `QuickAddModal.tsx`, `IncomeSourceDetailModal.tsx`, `JarDetailModal.tsx`, wiring trong `App.tsx`.

- Đề xuất callback thống nhất `openTransactionComposer({ type, accountId?, jarId?, incomeSourceId?, occurredAt? })`. Đây là API nội bộ mới; thay các callback mang tên ghi thu nhưng bị dùng để ghi chi.
- “Ghi chi tiêu” từ hũ => type expense, preselect đúng jarId. “Ghi thu tiền” từ nguồn A => income, nguồn A. “Thu khác” => `incomeSourceId = null` tường minh.
- Mỗi lần mở mới reset amount, description, lỗi, saving và account mặc định hợp lệ. Giữ draft chỉ khi người dùng chọn “Lưu nháp”, có nhãn và hành động mở lại; không vô tình reuse state đóng bằng X.
- Nếu chưa có tài khoản, dẫn tới thêm tài khoản và quay về draft; không fallback ID `acc_cash` chưa tồn tại. Trường đang chọn phải thực sự phản ánh ID sẽ gửi.
- Sau lưu thành công: đóng form, invalidate summary/detail, hiển thị giao dịch vừa tạo. Lỗi thì giữ nội dung người dùng để sửa/thử lại.

**Nghiệm thu:** ghi chi từ hũ không mở ghi thu; mở A rồi đóng, mở Thu khác có form sạch và nguồn null; lỗi API không đóng form; thêm tài khoản mới giữ draft.

### V2-21 — Gọn thông tin, tăng khả năng đọc

Giữ bảng màu Dark Matte Slate đang dùng. Không đổi toàn bộ phong cách trong cùng đợt sửa nghiệp vụ.

**Bố cục Tổng quan đề xuất:**

1. Trạng thái đồng bộ nhỏ, cảnh báo số giao dịch cần duyệt và nút duyệt.
2. Thẻ tài sản hiện có tại thời điểm cập nhật; cơ cấu sáu lớp thu gọn mặc định, bấm mở hoặc sang Đầu tư/Tài khoản.
3. Thanh kỳ chung cho **báo cáo dòng tiền**, tách khỏi thẻ tài sản tại thời điểm hiện tại.
4. Ba con số thu/chi/chênh lệch, tiếp theo hai khối Nguồn thu và Hũ với tổng + tiến độ; chi tiết từng dòng có nút mở rộng.
5. Một hành động chính mỗi vùng; không xếp nhiều pill nhỏ cạnh tiêu đề dài.

**Ngân sách:** giữ hai chế độ “Kế hoạch” và “Đã ghi sổ”; “Thêm nguồn thu” khác “Ghi khoản thu”. Khi chưa có kế hoạch, không thay tổng dự kiến bằng số thực thu dưới cùng nhãn. Hũ dùng dòng hoặc card thích ứng; một cột khi màn hình hẹp/chữ lớn.

**Typography/layout:** nội dung chính 14–16 CSS px; nhãn phụ ưu tiên 12–13px; số tổng 24–28px tùy chiều rộng. Không dùng 9–10px cho thông tin cần đọc để quyết định. Mọi tiền dùng tabular numbers; `min-width: 0`, wrap có kiểm soát; tránh cắt mất dấu +/- hoặc số tiền. Tạo token chung cho spacing, surface, border, text, success/warning/error.

Kiểm tra tương phản theo cặp màu thực tế. Ví dụ audit tính được `#5A686B` trên `#182322` khoảng 2,79:1, cần tăng độ sáng nếu dùng làm chữ cần đọc. Không kết luận mọi màu xám hiện tại đều sai.

**Nghiệm thu:** kiểm tra 320/375/390/430px, landscape và tablet; chữ lớn/zoom 200% không che nút lưu hoặc làm mất tiền; không có tràn ngang ngoài vùng cuộn có chủ đích; màn Tổng quan mặc định không mở sẵn toàn bộ danh sách dài.

### V2-22 — Vùng chạm, modal và Back có thứ tự

- Với app WebView thiên về cảm ứng, chọn mục tiêu thiết kế nút chính 44–48 CSS px; icon có thể nhỏ nhưng hit area đủ lớn. Native Android dùng chuẩn dp tương ứng nền tảng, không coi CSS px và dp là một đơn vị. Khoảng cách nút gần nhau phải tránh chạm nhầm.
- Không mô tả 44px là mức tối thiểu duy nhất của WCAG: tiêu chí web AA có quy định 24 CSS px và ngoại lệ khoảng cách; V2 chọn vùng rộng hơn vì sản phẩm dùng trên điện thoại. [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Tạo modal/sheet shell dùng chung: role dialog, accessible name, focus vào trong, giữ focus trong modal, trả focus sau đóng; nền bên dưới inert; chỉ modal trên cùng nhận thao tác.
- Overlay registry/stack ở cấp App: Android Back, Escape và nút X đóng lớp trên cùng trước; hết overlay mới về Dashboard; ở gốc mới áp dụng double-back exit. Form dirty có bước giữ/lưu nháp phù hợp.
- Card tương tác dùng button/link đúng ngữ nghĩa; không lồng button vào button hoặc chỉ gắn role trên span không có keyboard handler. Nút icon có nhãn đọc được.
- Vuốt có kiểm tra chiều ngang so với chiều dọc, threshold và touchcancel/pointercancel; không duyệt nhầm khi cuộn. Luôn giữ nút Duyệt/Bỏ qua. Chặn double tap trong một mutation, Undo có điều phối theo V2-07.
- Bỏ khóa zoom trong viewport; hỗ trợ reduced motion, focus-visible, safe area và bàn phím ảo. CTA cuối form phải cuộn tới được trên màn nhỏ.

Modal theo [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

**Nghiệm thu:** Back đóng đúng chi tiết hũ/nguồn/form con trước; Tab không thoát ra nền; Escape đóng lớp trên cùng; screen reader đọc được nút và trường; cuộn dọc không ghi sổ; phóng to vẫn sử dụng được.

### V2-23 — Riêng tư nhất quán

- Đưa privacy state vào context/store chung; component hiển thị tiền dùng formatter/component chung với chính sách che phù hợp. Không chỉ che vài số tổng trên Dashboard.
- Bao phủ số dư, thu/chi, từng nguồn/hũ, lãi/lỗ, form chi tiết, toast, tooltip, aria-label và nội dung có thể copy. Không để tiền thật nằm trong title/accessible label khi phần nhìn đã che.
- Khi chủ động sửa hoặc sao chép số tiền, có thể cho “Hiện tạm” theo vùng với tín hiệu rõ, không âm thầm lộ toàn màn hình. QR/sao lưu là hành động chia sẻ riêng, cần nói rõ dữ liệu nào sẽ xuất ra.
- Lưu lựa chọn trên thiết bị; logout/xóa cache xử lý theo user. Privacy mode là che giao diện, không được gọi là mã hóa dữ liệu.

**Nghiệm thu:** bật ẩn rồi mở tất cả tab/modal/toast, không thấy tiền ngoài vùng anh chủ động hiện; reload giữ tùy chọn; screen reader không đọc giá trị bị che.

### V2-24 — Biểu đồ đúng dữ liệu và câu chuyện

- Sparkline hiện tại là dòng tiền thu–chi cộng dồn từ 0. Đưa nó vào khối dòng tiền, ghi nhãn “Dòng tiền ròng tích lũy trong kỳ”; không dùng dưới tổng tài sản như lịch sử biến động tài sản.
- Nếu muốn lịch sử tài sản, bổ sung snapshot `asOf`, giá trị account/holdings và nguồn định giá. Chỉ vẽ từ snapshot thật có chất lượng dữ liệu; không tự dựng lại giá quá khứ từ giá hiện tại. Thiếu snapshot thì hiển thị số hiện tại và trạng thái chưa có lịch sử.
- Thanh phân bổ dùng tỷ lệ giá trị thực; bỏ `Math.max(3, pct)` làm sai diện tích. Nhóm nhỏ có legend hoặc marker riêng. Tooltip/legend hiển thị số tiền, tỷ lệ và tên.
- Tài khoản âm không được dùng làm một độ rộng âm của biểu đồ tài sản. Hiện phần âm riêng hoặc chọn chart có hỗ trợ; công bố rõ mẫu số.
- Ngân sách vượt hạn mức: thanh có thể full, nhưng nhãn giữ đúng 120%/150%; số 0 dùng empty state, không default về danh mục mẫu của DonutChart.

**Nghiệm thu:** nhóm 1% không biến thành diện tích 3%; tổng tỷ trọng đúng theo contract; đổi kỳ không làm người dùng tưởng tổng tài sản hiện tại là snapshot cuối kỳ; không có dữ liệu thì không sinh đường tăng trưởng mẫu.

### V2-25 — Sửa sai và đối soát giao dịch thuận tiện

- Composer có ngày/giờ giao dịch với mặc định hiện tại theo VN; hiển thị thời gian gốc và thời gian nhận đối với notification gửi trễ.
- Sheet lịch sử cho sửa amount, description, account, jar/source và ngày; đổi type hoặc thành transfer đi qua luồng riêng có chọn đủ hai đầu và preview tác động số dư. Không cho sửa một chân ẩn độc lập.
- Backend nhận đầy đủ desired snapshot + revision; mọi thay đổi có tiền/tài khoản/trạng thái qua ledger service. Đổi ngày phải invalidate cả kỳ cũ và kỳ mới dù số dư không đổi.
- Bộ lọc lịch sử: khoảng ngày/kỳ, tài khoản, loại, hũ/nguồn, trạng thái; tìm nội dung/mã tham chiếu. Có tổng tiền và số lượng theo **toàn bộ filter**, nút xóa filter rõ ràng.
- Cử chỉ chính là mở chi tiết, không xóa ngay. Xóa có xác nhận và preview hoàn tiền; thao tác hàng loạt cần preview scope.
- “Duyệt tất cả” chỉ tác động tập đang được hiển thị/đã chọn, nói rõ số lượng; loại hoặc yêu cầu kiểm tra các bản mơ hồ, thiếu tài khoản/hũ cần chọn. Không dùng confidence mặc định 0,9 làm bằng chứng đã nhận diện tốt.

**Nghiệm thu:** thêm giao dịch tháng trước vào đúng kỳ; sửa 100 nghìn thành 200 nghìn cập nhật đúng tiền; tìm theo tài khoản/kỳ cho tổng đầy đủ dù nhiều trang; duyệt tất cả không duyệt các khoản bị ẩn ngoài filter.

### V2-26 — Trạng thái thật, đồng bộ nhẹ và sao lưu đầy đủ

**Trạng thái và đồng bộ:**

- Tách ba trạng thái: quyền Notification Listener trên thiết bị; credential thiết bị hợp lệ; kết nối/ACK cuối với server. Chưa kiểm tra được phải hiện “Chưa xác định”, không cố định “Đang hoạt động”.
- Android bridge chỉ expose trạng thái tối thiểu an toàn. Web chạy ngoài Android ghi “Đang dùng bản web; nhận thông báo cần app Android”, không giả listener đang bật.
- Đồng bộ khi app foreground/focus, sau mutation và khi người dùng refresh. Có thể polling nhẹ khi foreground, backoff khi lỗi và dừng khi background; không gọi lại danh sách Fmarket mỗi lần polling giao dịch.
- UI ghi giờ cập nhật cuối, số bản đang chờ gửi và lỗi cần xử lý; chỉ toast “Đã đồng bộ” khi các nguồn cần thiết tải thành công. Lỗi từng nguồn không xóa dữ liệu tốt đang có.
- Service worker hiện chưa ghi cache response. Nếu cung cấp chế độ offline thật, cache app shell có version, bundle tài nguyên thiết yếu và giữ cache dữ liệu riêng theo user. Không cache bừa raw API/auth response vào shared Cache Storage. Không quảng bá offline đầy đủ chỉ vì đăng ký SW.

**Sao lưu:**

1. Đổi export từ accounts-only sang gói theo schema version: profile, accounts, sources, jars, plans/versions, transactions/groups, holdings/investment transactions và dữ liệu ledger/baseline cần khôi phục. Raw notification chỉ đưa vào nếu anh chọn.
2. Không xuất credential, session, khóa thiết bị hoặc secret. Có manifest gồm schema version, thời gian, revision, counts và checksum. Nếu gói không gồm mọi dữ liệu cần restore, ghi rõ “bản xuất dữ liệu”, không gọi là bản sao lưu đầy đủ.
3. Export nhiều trang phải có snapshot/revision nhất quán; thay đổi trong lúc xuất phải restart hoặc báo stale. Không xuất một tệp trộn nhiều thời điểm rồi coi hợp lệ.
4. Đề xuất hỗ trợ mã hóa file theo mật khẩu; tệp rõ phải có nhãn chứa dữ liệu cá nhân. Import/restore là luồng riêng: kiểm tra schema/checksum/quyền, dry run, preview xung đột và tránh áp ledger hai lần.
5. Với restore trong cùng hệ thống, hoặc phục hồi snapshot số dư cùng baseline/ledger, hoặc replay postings vào sổ trống đã xác minh; không làm cả hai. Không tự merge full backup vào production khi chưa có hợp đồng merge ID/revision.

**Nghiệm thu:** web không báo listener native đang hoạt động; tắt quyền hiện đúng trạng thái; notification mới xuất hiện sau foreground sync; offline có nhãn; gói backup có đủ counts và restore trên môi trường sạch cho đúng số dư/tổng tiền, không chứa secret.

## 8. Thay đổi cấu trúc và migration đề xuất

Đây là danh mục thiết kế tối thiểu cần chốt ở đợt 0–2. Không cần tạo mọi bảng ngay một lần; từng đợt chỉ thêm phần đang dùng, với migration riêng.

| Nhóm | Trường/bảng đề xuất | Mục đích |
| --- | --- | --- |
| Tài khoản | `revision`, `archived_at`, baseline cutover, trạng thái đối soát | Sửa đồng thời, giữ lịch sử, đối soát sổ |
| Giao dịch | `revision`, `deleted_at`, `history_hidden_at`, `classification_origin`, mốc legacy/cutover | Soft delete khác ẩn lịch sử, mutation có điều kiện |
| Ghi sổ | `mutation_receipts`, `mutation_assertions` hoặc trigger tương đương, `ledger_postings`, `ledger_baselines` | Guard thật trong DB, chống lặp và kiểm tra mọi delta |
| Nhóm chuyển | Canonical group ID, group revision, membership, snapshot gốc, cờ synthetic | Pair/unpair không mất dữ liệu gốc |
| Notification | `device_id`, `event_id`, thời gian gốc/nhận, parser version/status | Retry và reprocess đúng |
| Danh tính | Ánh xạ subject–user, `devices`, mã ghép một lần | Phân quyền và thu hồi thiết bị |
| Kế hoạch | `plan_versions`, hiệu lực không chồng lấn, cadence enum, ngày một lần | Báo cáo theo kế hoạch lịch sử |
| Thị trường | Provider/instrument/unit/priceAsOf/syncStatus tách riêng | Không nhầm đơn vị hoặc sản phẩm |
| Snapshot | `asset_snapshots` nếu triển khai biểu đồ lịch sử tài sản | Dữ liệu thực cho chart |
| Đồng bộ | `user_data_revision`, revision kế hoạch, schema version | Cache/detail/export nhất quán |
| Android | Room outbox và migration marker | Hàng đợi không bị mất khi process chết |

### 8.1. Quy trình chuyển dữ liệu

1. **Khảo sát chỉ đọc:** đếm bảng/row; thống kê số dư, tổng thu/chi theo kỳ, nguồn/hũ chưa ID, tài khoản mồ côi, thời gian sai kiểu, cặp trùng và giá không có nguồn rõ. Không in raw tài chính/OTP vào báo cáo công khai.
2. **Bản sao lưu độc lập:** export database và ghi mốc khôi phục; xác minh có thể đọc/khôi phục vào database khác. Không gọi một file accounts-only là đủ để quay lại.
3. **Migration đánh số:** tạo `backend/migrations/*.sql` theo cấu hình Wrangler; quản lý bằng bảng migration của D1. `schema.sql` dùng cho database mới cần phản ánh schema mới, không làm công cụ reset database thật. Theo [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).
4. **Tiền kiểm:** các row không hợp lệ được giữ và đưa vào danh sách đối soát trước khi áp constraint. Không tự sửa amount thành 0, xóa lịch sử hoặc gán user/tài khoản để cho migration chạy qua.
5. **Expand trước, chuyển dữ liệu sau:** thêm cột/bảng nullable hoặc có default an toàn, backfill theo batch có run ID/checkpoint, đối soát rồi mới bật contract bắt buộc. Migration chạy lại không double-backfill.
6. **Cutover ledger:** ngăn ghi trong cửa sổ chuyển ngắn được lên lịch; lưu baseline/revision; bật duy nhất dịch vụ ledger mới; bỏ các đường UPDATE số dư cũ. Snapshot số dư cutover bảo toàn số đang hiển thị, không tự chứng minh số dư ấy đúng với ngân hàng.
7. **Cutover client/Android:** client biết schema/API version. APK cũ thiếu auth cần được cập nhật và ghép thiết bị; queue giữ lại để chuyển sang phiên bản mới. Không mở lại endpoint quản trị công khai để hỗ trợ client cũ.
8. **Đối soát sau chuyển:** số lượng, liên kết, tổng tiền, lịch sử và baseline/postings; thử đọc, ghi, undo trên staging. Mỗi chênh lệch cần giải thích được bằng bản ghi migration/adjustment.
9. **Rollback:** ưu tiên rollback app bằng feature flag tương thích schema mới; không drop dữ liệu mới phát sinh. Khôi phục backup cần quy trình dừng ghi và đối chiếu các operation sau mốc backup để không mất giao dịch mới.

Không dùng `catch { /* cột đã tồn tại */ }` để nuốt mọi lỗi ALTER trong request-path. Lỗi transient, quyền hoặc schema sai phải được báo; startup/health phải phân biệt phiên bản schema chưa sẵn sàng. Nếu SQLite buộc rebuild bảng để thêm constraint, phải có kế hoạch riêng trên bản sao và rà lại quy tắc bảo toàn dữ liệu, không lén DROP bảng đang chứa dữ liệu thật.

### 8.2. Sửa dữ liệu đã bị ảnh hưởng

| Trường hợp cũ | Cách xử lý |
| --- | --- |
| Amount parse sai nhưng pending | Reparse bản raw, preview khác biệt, cho xác nhận; chưa có delta sổ |
| Amount sai ở confirmed | Giữ audit trước/sau; sửa qua ledger delta; không UPDATE số tiền trần |
| Epoch milliseconds lưu trong occurred_at | Chuyển kiểu theo quy tắc/range xác định được; giữ original; dòng mơ hồ cần xem lại |
| Legacy income thiếu source ID | Giữ chưa phân loại; tạo gợi ý mapping, không tự includes rồi ghi |
| Mất số tài khoản đầy đủ | Lấy lại từ backup/D1 nếu còn hoặc yêu cầu nhập; không đoán từ mask |
| Cặp transfer ghép nhầm | Dùng snapshot/raw để preview; tách qua ledger, xử lý synthetic leg riêng |
| Giá SJC có thể từng bị PAXG ghi đè | Đánh dấu cần xác nhận giá/nguồn; không tự bịa giá SJC lịch sử |
| Số dư hiện tại lệch nhưng không đủ chứng cứ | Màn đối soát với adjustment có xác nhận và lý do; không tự replay toàn bộ lịch sử |

## 9. Thứ tự triển khai và phạm vi file

File mới là **đề xuất**, agent có thể chọn tên tương đương khi ghi rõ trong hợp đồng của đợt. Khi cần file ngoài phạm vi đã chốt cho một đợt, phải giải thích quan hệ requirement trước khi thay đổi.

| Đợt | Mục tiêu và phụ thuộc | File/module dự kiến | Điều kiện kết thúc |
| --- | --- | --- | --- |
| 0 | Chốt contract, baseline dữ liệu, tạo harness; trước mọi sửa production | Tài liệu contract, test fixtures/harness, package scripts cần thiết, `.qc` policy riêng dự án nếu dùng SuperQC | Có fixture bất biến; lệnh test thực sự tồn tại; backup thử được; chưa tác động dữ liệu thật |
| 1 | Auth và bảo toàn account/QR — V2-01,08 | Backend middleware/auth/devices; frontend API transport/account mapping; Settings/QR; Android credential; Wrangler binding nếu cần | Unauthorized/forbidden bị chặn; onboarding chủ tài khoản và thiết bị chạy; account round-trip đủ trường |
| 2 | Ledger, reset, archive, pair state — V2-02,09,10,11; dựa đợt 1 | Backend migrations, ledger/mutation/validation; route transactions/accounts/reset/pair; frontend contract mutation | Race/retry/rollback/reversal đạt trên D1; baseline được bảo toàn; không còn đường ghi số dư ngoài service |
| 3 | Ingest/parser/time/account match/Android outbox — V2-03,04,05,06,10; dựa đợt 1,2 | Parser/rules/dedupe/accountMatcher; ingest/reprocess; Kotlin listener/Room/worker/MainActivity; Gradle deps cần thiết | Tái hiện lỗi cũ rồi fix; epoch/ISO đúng; offline reboot/retry không mất hoặc nhân bản; auto-pair yếu chỉ gợi ý |
| 4 | Frontend mutations, composer và edit — V2-07,20,25; dựa đợt 2 | App state, apiClient/outbox/queryStore; QuickAdd/Budget/Inbox và modal callbacks | Không thành công giả; lỗi giữ draft; shortcut đúng; sửa ngày/tiền/tài khoản và Undo đồng bộ |
| 5 | Analytics, phân nhóm, kỳ và phân bổ — V2-12,13,14,15,17; dựa đợt 2–4 | Backend analytics/transactions filters; shared finance contract; Dashboard/Budget/detail; financeMath/dateUtils/types | Các tổng bảo toàn; trên 1.200 dòng đủ; card/detail cùng range/revision; chia tiền không lệch |
| 6 | Version kế hoạch — V2-16; dựa đợt 5 | Plan migrations/API/service, form nguồn thu/chi/hũ, expected calculations | Một lần không nhân 12; historical plan không bị viết lại; bình quân và lịch tiền phân biệt rõ |
| 7 | Giá/đơn vị/định nghĩa P&L — V2-18, phần bắt buộc V2-19 | Market adapters, asset/holding schema/API; Investments và form holdings cũ; Dashboard asset summary | SJC không bị thay bằng PAXG; đơn vị đúng; giá stale rõ; P&L dùng đúng tên và precision |
| 8 | UI/UX và accessibility — V2-21,22,23,24,25; sau contract chính | CSS/design tokens; UI shell/overlay; Dashboard/Budget/Inbox/Investments/Settings; formatter privacy; Android Back | Hoàn thành checklist mobile/zoom/focus/gesture/privacy/chart; không làm mất bất biến đã đạt |
| 9 | Trạng thái, sync, backup và gate tích hợp — V2-26; dựa các đợt trên | App sync/store, SW, Settings, bridge trạng thái; export/restore API và tool kiểm tra | Backup thử restore được; trạng thái thật; integrated regression/manual Android đạt; có handoff rõ |
| 10 | Mở rộng investment ledger/XIRR — phần mở rộng V2-19 | Investment transaction service/schema/UI và solver, fixture đối chiếu | Buy/sell/fees/tax/dividends theo scope; không double-count tiền; XIRR có dữ liệu và nghiệm hợp lệ |

### 9.1. Phạm vi được bảo vệ trong mọi đợt

- D1 production và KV/state đang có; không gọi reset/seed để xác minh.
- Keystore, secret, private key, credential và cấu hình cá nhân ngoài phạm vi được cấp quyền.
- Các thay đổi đang dang dở của anh/agent khác; đọc `git status` trước mỗi patch.
- Đợt đã đạt, trừ khi một requirement mới thật sự thay đổi hợp đồng liên quan và có test hồi quy.
- File lock/dependency chỉ đổi khi harness hoặc tính năng của đúng đợt cần; không nâng package hàng loạt.
- Không nhân cơ hội tách toàn bộ file lớn, đổi framework hoặc đổi phong cách UI. Có thể tách module nhỏ khi chính requirement cần một nguồn tính toán/ghi dữ liệu duy nhất.

### 9.2. Cách chốt một đợt

1. Chọn 1–3 requirement gắn chặt nhau; xác nhận precondition, transformation, lỗi và postcondition.
2. Tạo fixture tái hiện trên code cũ; lưu kết quả thất bại thực tế. Nếu khó tái hiện deterministic phải giải thích và bổ sung bằng chứng thay thế, không tự viết log đỏ.
3. Patch trong phạm vi file; chạy kiểm tra đúng module; kiểm tra diff và migration data contract.
4. Chạy integration với D1 local cho nghiệp vụ DB; Android/emulator/thiết bị thật cho lifecycle; browser cho UI thực.
5. Báo cáo requirement nào đã viết, đã test, chưa verified. Build xanh không thay cho nghiệm thu logic.
6. Mỗi đợt chỉ đánh dấu hoàn thành khi core behavior đạt; không đẩy lỗi số tiền/bảo toàn dữ liệu thành việc vặt để pass.

## 10. Ma trận nghiệm thu bắt buộc

Kết quả mặc định của toàn bộ **46 tình huống** trong bảng này tại thời điểm lập V2 là **CHƯA CHẠY**. Mỗi test cần lưu fixture, lệnh/bước thực hiện, expected, actual và bằng chứng. Các số tiền là dữ liệu kiểm thử, không phải dữ liệu thật của anh.

| Test ID | Requirement | Tình huống và expected |
| --- | --- | --- |
| AT2-01 | V2-01 | Không đăng nhập gọi đọc/reset/delete => 401; credential ingest gọi quản trị => 403; dữ liệu không đổi |
| AT2-02 | V2-01 | Giả userId hoặc ID tài khoản của user khác => không truy cập/sửa được; session hết hạn/thiết bị bị revoke bị chặn |
| AT2-03 | V2-02 | A=5 triệu, B=1 triệu; chuyển 2 triệu => A=3 triệu, B=3 triệu, tổng 6 triệu, thu/chi kỳ không tăng |
| AT2-04 | V2-02 | 20 confirm đồng thời cùng revision => hiệu ứng số dư đúng một lần; replay cùng operation không tăng posting |
| AT2-05 | V2-02 | Cùng operation ID khác payload => 409; lỗi SQL/constraint giữa mutation => toàn bộ trạng thái, posting, receipt rollback |
| AT2-06 | V2-02,25 | Chi confirmed 100 nghìn đổi 200 nghìn => trừ thêm 100 nghìn; đổi account => hoàn nguồn cũ/trừ nguồn mới; delete => về đúng số trước giao dịch |
| AT2-07 | V2-03 | Hai tài khoản VCB 1111/2222: mask 2222 vào đúng tài khoản; thiếu mask + nhiều ứng viên => cần chọn, không tự gán |
| AT2-08 | V2-04 | `TK 12345678 thanh toán 150,000 VND ngày 08-11-2026. So du: 2,000,000 VND` => expense 150000, không phải 11 |
| AT2-09 | V2-04 | Unicode minus, `.00`, `,00`, balance 0, nhiều số tiền và OTP: parse đúng hoặc báo mơ hồ; OTP không lưu |
| AT2-10 | V2-04,06 | Cùng event gửi lặp chỉ một pending; hai event thật cùng tiền/reference khác nhau không bị mất vì dedupe heuristic |
| AT2-11 | V2-05 | Epoch-ms Android và ISO cùng thời điểm ra cùng ISO canonical; 01:30 ngày 01/12 VN thuộc tháng 12 |
| AT2-12 | V2-05 | Reprocess notification tháng trước hôm nay vẫn vào tháng trước; chạy lại hai lần không tạo transaction mới; không đổi chủ dữ liệu |
| AT2-13 | V2-06 | Offline nhận nhiều notification, kill process/reboot rồi có mạng: gửi đủ, không cần đợi notification mới |
| AT2-14 | V2-06 | Server commit/client timeout => retry không trùng; validation lỗi sang hàng lỗi; 401 giữ queue; 429/5xx retry có backoff |
| AT2-15 | V2-07 | Lưu 400/500 không báo thành công/không giả confirmed; reload còn draft; phục hồi mạng gửi một lần hiệu dụng |
| AT2-16 | V2-07 | Confirm rồi Undo khi mạng chậm => cuối cùng pending và số dư ban đầu; request không vượt nhau làm server confirmed trở lại |
| AT2-17 | V2-08 | Account đầy đủ số/chủ/chi nhánh/BIN qua thêm, reload, sửa riêng tên, reload vẫn nguyên; chỉ có mask thì không tạo QR |
| AT2-18 | V2-09 | Reset income không thay transactions/balances/planned expenses/jar budget; reload không seed lại nguồn mẫu |
| AT2-19 | V2-09 | Ẩn lịch sử giữ tiền không đổi baseline/postings; lựa chọn hoàn tác có số dư đúng preview; reset all adjustment về 0; replay/rebuild/restore không cộng lại posting cũ |
| AT2-20 | V2-10 | Hai khoản độc lập cùng tiền trong 120 phút chỉ thành gợi ý; ghép phải có xác nhận/bằng chứng đủ theo contract |
| AT2-21 | V2-02,10 | Pair/unpair/delete bằng primary hoặc hidden ID đều đúng; tranh cùng ứng viên chỉ một nhóm thắng; synthetic leg không biến thành khoản thật |
| AT2-22 | V2-11 | Archive account còn lịch sử không mất tên/delta; số dư còn sở hữu không biến mất khỏi tổng tài sản; không chọn account archive để ghi mới |
| AT2-23 | V2-12 | Một thu 10 triệu gán Lương chính, có thêm nguồn Lương => tổng buckets đúng 10 triệu, không 20 triệu |
| AT2-24 | V2-12 | Legacy chưa ID dù tên gần nguồn vẫn unassigned trước xác nhận; orphan mang originalSourceId; card/count/detail khớp; đổi tên nguồn không đổi tổng |
| AT2-25 | V2-13 | Chi 300 nghìn có hũ + 200 nghìn chưa hũ => tổng 500 nghìn, phân rã 60/40; archive hũ không làm mất 300 nghìn |
| AT2-26 | V2-14 | Trên 1.200 giao dịch và nhiều pending: tổng kỳ bằng SQL toàn bộ; phân trang không trùng/mất; revision đổi báo stale |
| AT2-27 | V2-14 | Sửa tiền/hũ khi số lượng không đổi vẫn cập nhật summary; offline không gắn nhãn đầy đủ cho một trang local |
| AT2-28 | V2-15 | Chọn tháng 9/quý 3 trên Dashboard rồi mở nguồn/hũ => giữ kỳ; all-time không dùng mẫu số tháng; expected 0 không hiện KPI giả |
| AT2-29 | V2-16 | Một lần 12 triệu ngày 15/09 => tháng 9 và cả năm chỉ cộng 12 triệu; năm khác bằng 0 |
| AT2-30 | V2-16 | Annual 12 triệu => bình quân 1 triệu/tháng, tổng năm đúng; đổi plan tháng 10 không sửa tháng 9; tuần bình quân không bị gọi là lịch tiền chính xác |
| AT2-31 | V2-17 | 1.000.001 VND chia 33/33/34 tổng đúng; ba hũ bằng nhau chia 100.000 đúng và ổn định; 110% bị chặn |
| AT2-32 | V2-18 | SJC nhập tay không bị PAXG overwrite; gram/chỉ/lượng đúng; upstream lỗi giữ giá cuối và trạng thái stale, không báo đã lấy giá mới |
| AT2-33 | V2-18,19 | Decimal quantity/NAV nhân trước làm tròn; đổi symbol không thêm bản sao; giá vốn 0 không tạo % lợi nhuận giả |
| AT2-34 | V2-20 | Ghi chi từ hũ => expense đúng jar; mở thu A rồi mở Thu khác => source null và form sạch; account chưa có thì đi thêm, không gửi ID giả |
| AT2-35 | V2-21 | 320/375/390/430px, landscape, chữ lớn/zoom 200%: tiền đầy đủ, nút lưu chạm được, không tràn ngang ngoài vùng cuộn chủ đích |
| AT2-36 | V2-22 | Back/Escape đóng overlay trên cùng; Tab giữ focus trong modal và trả về; cuộn dọc không duyệt; reduced motion vẫn dùng được |
| AT2-37 | V2-23 | Privacy che tiền ở mọi tab/modal/toast/tooltip/aria, không copy ngầm tiền thật khi ẩn; chủ động hiện/chia sẻ có tín hiệu rõ; reload giữ tùy chọn |
| AT2-38 | V2-24 | Dòng tiền được ghi đúng nhãn, không giả lịch sử tài sản; nhóm 1% đúng diện tích; rỗng không xuất hiện chart mẫu |
| AT2-39 | V2-25 | Nhập ngày cũ/sửa ngày sang kỳ khác cập nhật hai kỳ; filter account/range/type cho tổng toàn bộ; bulk approve đúng tập đã chọn |
| AT2-40 | V2-26 | Web không giả listener active; tắt quyền/revoke/network error phản ánh đúng; foreground sync cập nhật, không refresh market liên tục |
| AT2-41 | V2-26 | Export đủ counts/schema/revision, không secret; dữ liệu đổi lúc export báo stale; restore trên môi trường sạch khớp ledger/baseline và không áp tiền hai lần |
| AT2-42 | V2-19 | Sau khi làm đợt 10: -10 triệu 01/01/2025, +11 triệu 01/01/2026 => XIRR gần 10%; thiếu hai dấu/không hội tụ báo không xác định |
| AT2-43 | V2-19 | Buy/sell/phí/thuế/cổ tức theo contract; chuyển vào CK rồi mua không trừ tiền/tổng tài sản lần hai; góp/rút ngoài không lẫn giao dịch nội bộ trong XIRR |
| AT2-44 | V2-14,15,16 | Chỉ sửa plan, count/dataRevision không đổi nhưng planRevision tăng => KPI/card/detail expected refresh hoặc báo stale; không trộn hai phiên bản |
| AT2-45 | V2-16 | Kế hoạch hiệu lực đủ năm: annual 10 VND hoặc quarterly 1.000.001 VND có tổng năm đúng 10 và 4.000.004 VND; tổng các tháng phân bổ cũng bằng năm, không nhân 12 từ số bình quân đã làm tròn |
| AT2-46 | V2-02,17 | NaN/Infinity/số âm/thập phân VND không hợp lệ/trên MAX_SAFE_INTEGER bị từ chối, không mutate; amount giao dịch bằng 0 bị chặn nhưng allocation T=0 ra toàn 0; phép nhân lớn không tràn, tie-break ổn định |

### 10.1. Các bất biến nên tự động kiểm tra

```text
Balance(account) = BaselineAtCutover(account) + SUM(postings.deltaVnd của account)
SUM(deltaVnd của transfer nội bộ thuần, trên các account thuộc user) = 0
TotalIncome(range) = AssignedIncome + UnassignedIncome + OrphanedIncome
TotalExpense(range) = AssignedExpense + UnassignedExpense + OrphanedExpense
SUM(AllocateVnd(T, weights)) = T, nếu weights hợp lệ
Same operation + same payload => không thêm tác động sổ
Failed operation => không có thay đổi sổ/giao dịch/nhóm một phần
Summary(range, filter, revision) = Total của detail cùng range/filter/revision
```

Không áp bất biến transfer tổng 0 cho thao tác có phí ngoài: phí là giao dịch expense riêng. Không yêu cầu mọi giao dịch legacy đã có posting nguyên thủy; chúng được bao gồm trong baseline, các mutation sau cutover mới tạo delta.

`history_hidden_at` chỉ thay đổi phạm vi hiển thị/báo cáo sau reset, không được lọc postings khỏi công thức balance. Baseline cutover không bị đặt lại mỗi lần ẩn lịch sử. Test restore phải bao gồm cả lịch sử ẩn và adjustment reset để phát hiện cộng tiền kép.

### 10.2. Lệnh kiểm tra và giới hạn bằng chứng

Các lệnh sau dựa trên package hiện có, chạy từ đúng thư mục khi triển khai:

```powershell
# Frontend: typecheck và build theo script hiện có
Set-Location -LiteralPath 'D:\@Dư án softwear\QLTC cá nhân\frontend'
npm run build

# Backend: TypeScript theo tsconfig hiện có
Set-Location -LiteralPath 'D:\@Dư án softwear\QLTC cá nhân\backend'
npx tsc --noEmit -p tsconfig.json

# Repository: rà phạm vi patch và lỗi whitespace
Set-Location -LiteralPath 'D:\@Dư án softwear\QLTC cá nhân'
git diff --name-only
git diff --check
```

- Đợt 0 bổ sung test runner/script phù hợp React, Worker/D1 và Kotlin; ghi lệnh thật vào package/Gradle và hợp đồng từng đợt. Hiện repo chưa có các script nghiệp vụ ấy, không được ghi một lệnh đề xuất như thể đã tồn tại.
- Ledger/pagination/migration cần chạy với SQLite/D1 thực của môi trường test, không chỉ mock trả `success: true`. Chạy staging cho các đặc tính D1 trọng yếu trước production; không dùng tài khoản/database thật làm fixture.
- Kiểm tra Android bằng Gradle/emulator hoặc điện thoại có cấp quyền, test lifecycle/offline/reboot; không xem build APK thành bằng chứng queue đã hoạt động.
- UI cần browser thật ở kích thước nêu trên và Android WebView; lưu ảnh trạng thái cần chứng minh, kiểm tra keyboard/focus/zoom. DOM snapshot hoặc đọc className chưa đủ kết luận giao diện đã đẹp/dễ dùng.
- Full regression chạy ở gate tích hợp và sau thay đổi có nguy cơ hồi quy; không chạy lặp toàn bộ chỉ để tạo nhiều log xanh.

## 11. Bàn giao và tiêu chí hoàn thành V2

Mỗi đợt bàn giao phải có bảng:

| Requirement | File/hàm đã đổi | Test ID | Lệnh/bước đã chạy | Kết quả thực | Chưa kiểm chứng |
| --- | --- | --- | --- | --- | --- |
| V2-xx | Đường dẫn và symbol thật | AT2-xx | Lệnh/bước cụ thể | PASS/FAIL + bằng chứng | Phần còn lại |

- Không có hàng tương ứng requirement thì chưa hoàn thành requirement đó.
- Lỗi auth, ghi sai/mất/nhân đôi tiền, migration mất dữ liệu hoặc tổng không đối soát được là blocker; không chuyển thành cosmetic debt.
- UI polish nhỏ có thể ghi backlog sau khi các luồng chính đạt, nhưng chữ/nút khiến anh không thể hoàn thành thao tác, privacy rò số tiền hoặc Back làm mất draft không phải lỗi trang trí.
- Sau đợt 9 có thể phát hành bản sửa cốt lõi với chỉ số đầu tư đã đặt tên đúng; phần XIRR đợt 10 cần báo rõ còn kế hoạch nếu chưa triển khai. Chỉ nói **hoàn thành toàn bộ V2** khi cả phần đã cam kết của đợt 10 cũng đạt.
- Version/release notes chốt theo mã đã nghiệm thu; không ép tăng phiên bản sau mỗi chỉnh sửa tài liệu hoặc patch nội bộ đang làm dở.
- Báo cáo cuối tách rõ: đã sửa source, đã test tự động, đã test giao diện/Android, dữ liệu đã migration hay mới dry run, và việc cần anh quyết định ở bước triển khai thực tế.

## 12. Các quyết định cần xác nhận khi bắt đầu triển khai

Những điểm này không cản việc lập V2; cần ghi lựa chọn cụ thể trong hợp đồng trước đợt liên quan:

1. Email/nhà cung cấp đăng nhập của chủ tài khoản và domain dùng cho Access/gateway; kiểm tra cấu hình bảo vệ hiện có để tránh làm hai lớp đăng nhập không cần thiết.
2. Thời điểm cutover ledger, bản sao lưu dùng đối soát và cách xử lý số dư lệch đã có từ trước. Không tự quyết điều chỉnh tiền của anh.
3. Khoản “Một lần” cũ thiếu ngày và version kế hoạch cũ: anh bổ sung ngày/kỳ hoặc giữ trạng thái chưa đủ dữ liệu lịch sử.
4. Nhà cung cấp giá SJC trong nước nếu muốn AutoSync; khi chưa có nguồn phù hợp dùng nhập tay, không thay bằng giá sản phẩm khác.
5. Phạm vi đầu tư ở đợt 10: buy/sell/phí/thuế/cổ tức/chia tách hỗ trợ đến đâu; XIRR theo toàn danh mục hay từng tài sản cần được hiển thị theo phạm vi đã chọn.
6. Chính sách backup: xuất rõ hay mã hóa mật khẩu, có raw notification hay không, và thời hạn giữ dữ liệu lỗi/queue trên thiết bị.

**Trạng thái tài liệu:** phương án đã lập; toàn bộ thay đổi source, migration và nghiệm thu triển khai vẫn đang ở trạng thái **ĐỀ XUẤT / CHƯA THỰC HIỆN**.
