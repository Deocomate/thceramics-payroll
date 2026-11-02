# Database

Kho dữ liệu là capability `db` của nền tảng: tài liệu JSON theo đường dẫn `collection/docId`, tối đa 256 KiB/tài liệu. Các collection dưới đây do `src/app.html` tạo.

> **Dữ liệu thật hiện có trong hệ thống đang chạy là dữ liệu lương đã mã hóa** (từng người một khóa riêng). Bản sao dữ liệu thật **không** nằm trong gói này vì (a) dev không giải mã được nếu không có mật khẩu, (b) có chứa khóa đã bọc bằng mật khẩu nhân viên. Dùng `demo-fixtures.json` (dạng rõ, số liệu giả) để thiết kế/test.

## Bản đồ collection

| Path | Mã hóa? | Ai đọc | Nội dung |
|---|---|---|---|
| `cfg/main` | Không (trừ khóa bọc) | mọi người đã đăng nhập | Cấu hình chung + danh sách nhân viên + khóa bọc cho chủ |
| `kw/{staffId}` | Không (khóa bọc) | mọi người đã đăng nhập | Muối + khóa dữ liệu của nhân viên bọc bằng mật khẩu nhân viên |
| `sal/{staffId}` | **Có** | người có khóa | Hồ sơ lương của người đó |
| `sp/{staffId}` | **Có** | người có khóa | Tài khoản ngân hàng nhận lương |
| `sd/{staffId}_{YYYY-MM}` | **Có** | người có khóa | Chấm công cả tháng (map theo ngày) |
| `bon/{staffId}_{YYYY-MM}` | **Có** | người có khóa | Thưởng / khấu trừ trong tháng |
| `months/{YYYY-MM}` | Không | mọi người đã đăng nhập | Doanh thu tháng, công chuẩn, trạng thái chốt/đã trả |

`staffId` hiện là `nv1`, `nv2`, `nv3`. "Người có khóa" = chính nhân viên đó (đăng nhập bằng mật khẩu riêng), chủ (mật khẩu chủ), hoặc super admin trên server riêng.

## Tài liệu rõ (không mã hóa)

### `cfg/main`
```jsonc
{
  "v": 1,
  "company": "Gốm Vũ Gia",
  "owner": { "salt": "<b64 16B>", "check": { "iv": "<b64>", "ct": "<b64>" } },   // check = AES-GCM({ok:1}), AAD "owner-check"
  "staff": [ { "id": "nv1", "name": "An", "title": "Marketing 1", "wO": { "iv": "...", "ct": "..." }, "wA": { "iv": "...", "ct": "..." } } ],  // wO = khóa dữ liệu bọc bằng khóa chủ, wA = bọc bằng khóa khôi phục (chỉ có trên server riêng), AAD "wrap:nv1" cả hai
  "rates": { "lunch": 30000, "liveDay": 100000, "liveNight": 150000, "satFactor": 0.5 },
  "comm":  { "t1": 100000000, "t2": 300000000, "r1": 0.01, "r2": 0.02, "r3": 0.03,
             "capPct": 0.15, "cogs": 0.50, "ads": 0.20, "damage": 0.10, "other": 0 }
}
```
- `comm.r1..r3` là tỷ lệ 3 bậc lũy tiến (ví dụ 1% / 2% / 3%); `t1`,`t2` là ngưỡng doanh thu (VNĐ). `capPct` là trần theo % lãi đóng góp; `cogs/ads/damage/other` là % doanh thu dùng tính lãi đóng góp.
- Tỷ trọng chia quỹ hoa hồng (`share`) nằm trong `sal/{id}` (mã hóa), không nằm ở `cfg`.

### `kw/{staffId}`
```json
{ "salt": "<b64 16B>", "wS": { "iv": "<b64>", "ct": "<b64>" } }
```
`wS` = khóa dữ liệu (32 byte) bọc AES-GCM bằng khóa dẫn xuất từ mật khẩu nhân viên + `salt`; AAD `"wrap:" + staffId`.

### `months/{YYYY-MM}`
```json
{ "revenue": 400000000, "std": null, "locked": { "nv1": true }, "paid": { "nv1": "2026-11-05T03:00:00.000Z" } }
```
- `std`: công chuẩn nhập tay (null/thiếu = mặc định 24 công).
- `locked[id]`: đã chốt lương → nhân viên không sửa được chấm công kỳ đó (chủ vẫn sửa được).
- `paid[id]`: ISO time khi đánh dấu đã chuyển khoản (null/thiếu = chưa).

## Tài liệu mã hóa (phong bì)

Mỗi tài liệu mã hóa lưu dạng `{ "iv": "<b64 12B>", "ct": "<b64>", "at": <epoch ms> }`. Giải mã: AES-256-GCM, khóa = khóa dữ liệu của `staffId`, **AAD = đường dẫn tài liệu** (ví dụ `"sal/nv1"`, `"sd/nv3_2026-10"`) — nên chép tài liệu sang path khác sẽ không giải mã được.

Nội dung sau giải mã (xem ví dụ cụ thể trong `demo-fixtures.json`):

### `sal/{id}`
```json
{ "kind": "month|hour", "monthly": 9600000, "hourly": 0, "page": 0, "share": 0.3, "lunch": true, "live": false,
  "sched": { "wd": ["09:00","16:00"], "sat": ["09:30","12:30"], "liveD": ["12:00","14:00"], "liveN": ["19:00","21:00"] } }
```
`sched` chỉ dùng cho `kind: "hour"` (giờ ca chuẩn để tự điền khi quên bấm); thiếu thì dùng mặc định như trên. `share` của 3 người cộng lại ≤ 1.
`raises` (không bắt buộc, chỉ `kind: "month"`): `[{ "from": "2026-11", "monthly": 7200000 }]`, xếp tăng dần theo `from`. Mỗi tháng lấy mức mới nhất có `from` ≤ tháng đó, các tháng trước vẫn dùng `monthly`.

### `sp/{id}`
```json
{ "bin": "970436", "acct": "1234567890", "holder": "NGUYEN VAN A" }
```
`bin` là mã BIN ngân hàng theo VietQR (danh sách trong hằng `BANKS` của `src/app.html`).

### `sd/{id}_{YYYY-MM}`
```jsonc
{ "days": {
  "05": { "st": "half", "lunch": true, "note": "Đi khám", "ts": "<ISO>", "by": "self|owner", "late": true },      // lương tháng
  "02": { "seg": [ { "t": "main|liveD|liveN", "in": "09:05", "out": "", "src": "punch|auto|manual", "srcOut": "auto", "at": "<ISO>" } ],
          "note": "", "ts": "<ISO>", "by": "self", "late": false }                                              // lương giờ
} }
```
- `st`: `work` (đi làm) | `half` (nửa buổi, 0,5 công của ngày) | `paid` (nghỉ phép có lương, tính đủ công) | `off` (nghỉ không lương, 0 công); thiếu `st` = chưa chấm (không bị coi là nghỉ không lương).
- `lunch: true` = hôm đó **xưởng không phát cơm, nhân viên tự mua** → được cộng phụ cấp ăn trưa; chỉ có hiệu lực khi `st` là `work`/`half`, ngày T2–T6, và hồ sơ lương `lunch: true`.
- `pg: true` (lương giờ, có phụ cấp Fanpage) = hôm đó nghỉ công ty nhưng vẫn trực page: ngày T2–T7 không có ca chính được cộng giờ thêm (xem CALCULATIONS.md §2). Khung trực nằm ở `sal.sched.pgWd/pgSat/pgSun`.
- `fullDay: true` chỉ còn trong dữ liệu cũ, app bỏ qua: mọi ngày chấm Đi làm đều tính 1 công. `rates.satFactor` cũng không còn được dùng.
- `seg[].out` rỗng = ca còn mở. Ca còn mở của một ngày **đã qua** được `effSegs()` tự đóng theo giờ chuẩn khi tính (không ghi ngược vào DB).
- `src`: `punch` (bấm đúng giờ), `auto` (người dùng chọn "tôi quên bấm" → giờ chuẩn), `manual` (nhập tay trong form sửa ngày).
- `by`/`late`: dấu vết đối soát (`owner` = chủ sửa; `late` = nhân viên chấm bù ngày khác hôm nay).
- `req` (tùy chọn): yêu cầu nhân viên gửi chủ duyệt — `[ { "rid": "<id>", "type": "deduct|bonus", "amt": 1000000, "reason": "Tạm ứng tiền nhà", "d": "2026-10-31", "at": "<ISO>", "st": "pending|ok|no", "done": "<ISO>" } ]`. Nằm trong `sd` (không tạo path mới) vì nhân viên chỉ ghi được `kw/sd/sp`. Yêu cầu **chưa** tính vào lương; khi chủ duyệt, một item được chép sang `bon` (kèm `rq` = `rid`) và `st` thành `ok`. Nhân viên hủy được yêu cầu còn `pending` khi kỳ chưa chốt.

### `bon/{id}_{YYYY-MM}`
```json
{ "items": [ { "type": "bonus|deduct", "amt": 500000, "reason": "Đạt KPI quay video", "d": "2026-10-28", "at": "<ISO>", "rq": "<rid nếu đến từ yêu cầu>" } ] }
```
`reason` bắt buộc. `deduct` (khấu trừ/tạm ứng) trừ vào thực nhận. Chủ xóa được từng item; xóa item có `rq` không đổi yêu cầu gốc trong `sd`, nên yêu cầu đó vẫn ở `st: "ok"`.

## Mã hóa & khóa

```
KDF      : PBKDF2-HMAC-SHA256, 210.000 vòng, muối 16 byte (b64), ra khóa AES-GCM 256-bit
Dữ liệu  : mỗi nhân viên một khóa ngẫu nhiên 32 byte (DK_id), AES-GCM, IV 12 byte ngẫu nhiên mỗi lần ghi
Bọc khóa : DK_id bọc bằng KEK(mật khẩu chủ)  -> cfg.staff[i].wO
                         KEK(mật khẩu NV) -> kw/{id}.wS
                         khóa khôi phục   -> cfg.staff[i].wA  (chỉ server riêng; AAD "wrap:"+id cả ba)
Đăng nhập: giải mã được wS (hoặc wO) = mật khẩu đúng (không lưu hash mật khẩu)
Đổi MK NV: bọc lại DK_id với muối mới (rewrapStaff) — dữ liệu không phải mã hóa lại
Đổi MK chủ: tạo muối + check mới, bọc lại toàn bộ DK_id (opwForm)
```
Ghi nhớ đăng nhập: IndexedDB `gvg-login` trên từng trình duyệt, khóa `login` = `{ who, key }`; `key` là KEK không trích xuất được (`extractable: false`), không lưu mật khẩu. Đổi mật khẩu ở nơi khác thì KEK cũ không mở được `wS`/`check` nên máy đó phải đăng nhập lại. Bấm Đăng xuất là xóa. Khi đã ghi nhớ thì không tự đăng xuất sau 15 phút.
Hàm liên quan: `kdf`, `encBytes/decBytes`, `encJSON/decJSON`, `unlock`, `doLogin`, `restoreLogin`, `doSetup`, `rewrapStaff` trong `src/app.html`.

## Quy tắc truy cập (khai báo khi publish)

Xem `capabilities.json`: gốc `read: view, write: owner`; riêng `kw`, `sd`, `sp` cho `interact` ghi để nhân viên tự lưu. Lưu ý các tài liệu `sal`, `bon`, `months`, `cfg` chỉ chủ (owner) ghi được → nhân viên chỉ chấm công + tài khoản ngân hàng + đổi mật khẩu. Ghi dưới mức rule trả về `invalid_argument`, cùng mã với lỗi dữ liệu sai; tài khoản ngoài tổ chức chỉ ghi được khi là Người chỉnh sửa và artifact đã tắt link công khai.

Trên server riêng, `server/rules.js` thay cho `capabilities.json`: chưa đăng nhập không đọc được gì; nhân viên đọc `cfg`, `months` và tài liệu của mình, chỉ ghi `kw/sd/sp` của chính mình; chủ và super admin đọc, ghi tất cả. Chỉ super admin làm được thiết lập lần đầu vì chưa có tài khoản nào khác.

Bảng `accounts` (`who`, `username`, `salt`, `proof_hash`) giữ tài khoản của chủ và nhân viên. Mật khẩu không rời trình duyệt: `proof` = PBKDF2-HMAC-SHA256 của mật khẩu, 210.000 vòng, muối = `"gvg-auth:"` + `salt` của bảng này (khác muối của KEK), và máy chủ chỉ lưu `proof_hash` = SHA-256 của `proof`. Xem `proofOf` trong `server/runtime.js`, `passwordProof` trong `server/app.js`. Đổi mật khẩu phải cập nhật bảng này, và `proof_hash` nằm trong chữ ký cookie nên phiên cũ của người đó hết hiệu lực trên mọi máy.

Super admin không nằm trong bảng: tên và mật khẩu đến từ `ADMIN_USERNAME`, `ADMIN_PASSWORD`. Khóa khôi phục = HMAC của `SESSION_SECRET`, không đổi khi đổi mật khẩu, chỉ chủ và super admin lấy được qua `/api/recovery-key`. Lần chủ hoặc super admin mở dữ liệu tiếp theo, trình duyệt tự bọc lại `wA` nếu thiếu hoặc không mở được (`ensureRecovery` trong `src/app.html`). Vì vậy `SESSION_SECRET` cộng với database đủ để giải mã mọi dữ liệu.

## Truy vấn / quy mô

Không có truy vấn phức tạp: app đọc theo path cố định (`doc(path).get()`), mỗi lần đổi tháng đọc ~4 tài liệu × số nhân viên. Mỗi tháng mỗi người ≈ 1–2 tài liệu (≤ 256 KiB; một tháng chấm công ≈ vài KB).
