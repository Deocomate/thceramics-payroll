# Chạy trên Coolify

App chạy bằng Docker, lưu dữ liệu trong một file SQLite nằm trên volume `payroll-data`. Coolify lo tên miền và HTTPS nên không cần Nginx. Compose chỉ `expose` cổng 3000 trong mạng nội bộ, không mở cổng ra máy chủ, nên không trùng với app khác.

## 1. Tạo app trên Coolify

1. **Add New Resource**, chọn **Public Repository**, dán link repo, nhánh `main`.
2. **Build Pack**: chọn **Docker Compose**. File là `docker-compose.yml`, thư mục gốc `/`.
3. Ở service `app`, ô **Domains** điền tên miền kèm cổng nội bộ: `https://luong.ten-mien-cua-ban.vn:3000`. Phần `:3000` chỉ cho Coolify biết app nghe ở cổng nào, người dùng vẫn mở `https://luong.ten-mien-cua-ban.vn`.
4. Tab **Environment Variables**, đặt hai biến:
   - `DOOR_PASSWORD`: mật khẩu cửa hàng, ít nhất 8 ký tự.
   - `SESSION_SECRET`: chuỗi ngẫu nhiên, ít nhất 32 ký tự. Tạo bằng:

     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```

5. Bấm **Deploy**.
6. Mở `https://luong.ten-mien-cua-ban.vn/healthz`, thấy `{"ok":true}` là đã chạy.

Tên miền phải trỏ DNS về IP của server Coolify. App bắt buộc chạy qua HTTPS, vì trình duyệt chỉ cho mã hóa dữ liệu trên HTTPS. Mở bằng `http://địa-chỉ-ip` thì không đăng nhập được.

## 2. Chuyển dữ liệu từ Claude sang

**Làm trước khi báo mật khẩu cửa hàng cho nhân viên.** Lần đăng nhập đầu tiên của chủ sẽ ghi nhận cả 4 tài khoản, nên chủ phải là người vào đầu tiên.

1. Chạy `npm run build`, rồi đăng bản `dist/index.html` mới lên app trên Claude, vì nút sao lưu chỉ có từ bản này.
2. Trên app Claude, đăng nhập bằng mật khẩu chủ, vào **Cài đặt**, bấm **Tải file sao lưu**.
3. Dừng nhân viên chấm công trên Claude từ lúc này. Những gì lưu sau bước 2 sẽ không có trên server mới.
4. Chép file sao lưu lên máy chủ Coolify:

   ```bash
   scp gom-vu-gia-sao-luu-2026-11.json root@dia-chi-server:/tmp/
   ```

5. SSH vào máy chủ, tìm container rồi nạp dữ liệu. Tên container bắt đầu bằng `app-`, và có phần mã giống trong địa chỉ trang app trên Coolify:

   ```bash
   docker ps --format '{{.Names}}' | grep '^app-'
   ```

   ```bash
   docker cp /tmp/gom-vu-gia-sao-luu-2026-11.json TEN_CONTAINER:/tmp/sao-luu.json
   ```

   ```bash
   docker exec TEN_CONTAINER node server/import.js /tmp/sao-luu.json
   ```

6. Xóa file sao lưu trên máy chủ (`rm /tmp/gom-vu-gia-sao-luu-2026-11.json`).
7. Mở trang, nhập mật khẩu cửa hàng, rồi đăng nhập bằng mật khẩu chủ.
8. Kiểm tra số công và lương từng người, rồi báo địa chỉ và mật khẩu cửa hàng cho nhân viên. Mật khẩu riêng của mỗi người giữ nguyên như trên Claude.

Bắt đầu mới, không chuyển dữ liệu: bỏ qua phần này, mở trang rồi điền form thiết lập lần đầu. Việc này cũng phải do chủ làm trước tiên.

## Cập nhật app

Đẩy code mới lên nhánh `main` rồi bấm **Redeploy** trên Coolify, hoặc bật Auto Deploy. Dữ liệu nằm trên volume nên không mất khi deploy lại.

Không xóa volume `payroll-data` và không bật tùy chọn xóa volume khi xóa app, vì đó là toàn bộ dữ liệu.

## Sao lưu

Mất volume là mất toàn bộ chấm công và lương. Chủ nên vào **Cài đặt** bấm **Tải file sao lưu** hằng tháng rồi cất ở nơi an toàn. Nạp lại file đó bằng lệnh `node server/import.js <file> --force` trong container, lệnh này ghi đè dữ liệu đang có.

## Bảo mật

| Lớp | Tác dụng |
|---|---|
| Mật khẩu cửa hàng | Người ngoài không vào được trang. Sai 10 lần thì khóa 15 phút. Mỗi máy nhập một lần, nhớ 180 ngày. |
| Mã hóa trên trình duyệt | Máy chủ chỉ giữ bản đã mã hóa của lương, chấm công, tài khoản ngân hàng. Mật khẩu không bao giờ gửi lên máy chủ. |
| Phân quyền trên máy chủ | Nhân viên chỉ xem và ghi được dữ liệu của chính mình: chấm công, tài khoản ngân hàng, mật khẩu. Không tự sửa được lương, thưởng, doanh thu, cài đặt. |

Lưu ý:

- **Nhân viên nghỉ việc:** đặt lại mật khẩu của người đó **và** đổi `DOOR_PASSWORD` trên Coolify, rồi Redeploy và báo mật khẩu cửa hàng mới cho những người còn lại. Đặt lại mật khẩu thôi là chưa đủ, vì khóa dữ liệu của người đó không đổi. Người đã nghỉ vẫn giữ được khóa nếu trình duyệt của họ còn ghi nhớ đăng nhập.
- **Quên mật khẩu chủ thì mất dữ liệu**, như trên Claude. Máy chủ không giải mã được.
- Doanh thu, tên nhân viên và trạng thái chốt lương không mã hóa, giống bản trên Claude.
