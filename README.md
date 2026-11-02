# Payroll

Web app chấm công và tính lương cho cửa hàng nhỏ: nhân viên tự chấm công và xem lương của mình, chủ cửa hàng xem báo cáo, chốt lương và xuất thẻ lương kèm QR chuyển khoản VietQR.

Giao diện là một trang HTML + JS thuần, không framework. Máy chủ là Express + SQLite. Dữ liệu lương được mã hóa ngay trên trình duyệt, máy chủ chỉ giữ bản đã mã hóa.

## Tính năng

| Vai trò | Chức năng |
|---|---|
| Nhân viên lương tháng | Chấm trạng thái ngày (Đi làm, Nửa buổi, Phép, Nghỉ không lương), phụ cấp ăn trưa, xem lương, gửi yêu cầu tạm ứng hoặc đề xuất thưởng, nhập tài khoản ngân hàng, đổi mật khẩu |
| Nhân viên lương giờ | Bấm bắt đầu và kết thúc ca chính, ca live; tự điền giờ khi quên bấm; lịch công theo giờ |
| Chủ cửa hàng | Báo cáo lương, tổng quan 12 tháng, sửa chấm công, thưởng và khấu trừ, duyệt yêu cầu, chốt lương, đánh dấu đã trả, xuất CSV, xuất thẻ lương PNG/PDF kèm QR, cài đặt, sao lưu dữ liệu |

## Chạy trên máy

Cần Node.js 22.9 trở lên.

```bash
npm ci
cp .env.example .env
```

Điền `ADMIN_USERNAME`, `ADMIN_PASSWORD` và `SESSION_SECRET` trong `.env`, rồi:

```bash
npm run build
npm start
```

Mở http://localhost:3000, đăng nhập bằng tài khoản super admin trong `.env` rồi điền form thiết lập lần đầu.

## Lệnh

| Lệnh | Tác dụng |
|---|---|
| `npm run build` | Ghép `src/` thành `dist/index.html` |
| `npm start` | Chạy app |
| `npm test` | Build và chạy toàn bộ test. Lần đầu cần `npx playwright install chromium` |
| `npm run check` | Kiểm tra cú pháp, file không được đưa lên Git, rồi chạy test |
| `npm run import -- <file.json>` | Nạp file sao lưu vào máy chủ |

## Deploy

Có sẵn `Dockerfile` và `docker-compose.yml` cho Coolify. Các bước ở [docs/SERVER.md](docs/SERVER.md).

## Cấu trúc thư mục

```
src/app.html          Toàn bộ UI và logic (CSS, JS)
src/qr.js             Bộ mã hóa QR (Kazuhiko Arase, MIT), bọc thành biến QRLib
src/assets/           Logo
build.js              Ghép src/ thành dist/index.html
server/               Express + SQLite: phân quyền (rules.js), lưu trữ (store.js), nhập sao lưu (import.js)
server/runtime.js     Bản thay thế window.claude chạy trên trình duyệt
tests/                Test máy chủ (node:test) và test trình duyệt (Playwright)
db/SCHEMA.md          Cấu trúc dữ liệu, mã hóa, quy tắc truy cập
db/demo-fixtures.json Dữ liệu mẫu dạng rõ, số liệu giả
```

## Kiến trúc

- **Một file, render bằng template string.** `render()` ghi lại `#app.innerHTML`, sự kiện bắt ở `document` theo `data-act`, `data-chg` và form. Bảng `ACT`, `CHG`, `SUBMIT` trong `src/app.html` là nơi đăng ký hành vi.
- **Hai cách chạy từ cùng một trang.** App gọi `window.claude.use('db' | 'user' | 'downloads')`. Trên Claude artifact, nền tảng cung cấp các hàm này. Trên server riêng, `server/runtime.js` thay thế chúng bằng các lệnh gọi `/api`.
- **Tính toán** gom ở `calcPay(id)`, `commission()`, `hourDay()`, `effSegs()`. Giao diện chỉ đọc kết quả.
- **Mã hóa phía trình duyệt** (Web Crypto). Mỗi nhân viên có một khóa dữ liệu AES-256 riêng, bọc bằng khóa dẫn xuất từ mật khẩu của người đó, bằng khóa dẫn xuất từ mật khẩu chủ, và trên server riêng thêm bằng khóa khôi phục của super admin. Chi tiết trong [db/SCHEMA.md](db/SCHEMA.md).
- **Tài khoản và phân quyền trên máy chủ.** Mỗi người đăng nhập bằng tên đăng nhập và mật khẩu riêng, super admin nằm trong biến môi trường. Mật khẩu không rời trình duyệt, máy chủ kiểm tra bằng chứng dẫn xuất từ mật khẩu, rồi `server/rules.js` quyết định ai được đọc và ghi gì.

## Giới hạn đã biết

1. Giờ chấm công lấy từ đồng hồ thiết bị của nhân viên, không phải giờ máy chủ. Lịch có nhãn "chấm bù" và báo cáo có số "ngày sửa" để chủ đối soát.
2. Trên server riêng, quên mật khẩu chủ thì super admin đặt lại được, nhân viên quên mật khẩu thì chủ hoặc super admin đặt lại được. Trên Claude artifact không có super admin, nên quên mật khẩu chủ là mất dữ liệu đã mã hóa.
3. Doanh thu, tên nhân viên và trạng thái chốt lương không mã hóa.
4. Thẻ lương dùng font từ Google Fonts.
5. Giao diện chỉ có tiếng Việt, đơn vị tiền VNĐ.
