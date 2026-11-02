# Chạy trên Coolify

App chạy bằng Docker, lưu dữ liệu trong một file SQLite nằm trên volume `payroll-data`. Coolify lo tên miền và HTTPS nên không cần Nginx. Compose chỉ `expose` cổng 3000 trong mạng nội bộ, không mở cổng ra máy chủ, nên không trùng với app khác.

## 1. Tạo app trên Coolify

1. **Add New Resource**, chọn **Public Repository**, dán link repo, nhánh `main`.
2. **Build Pack**: chọn **Docker Compose**. File là `docker-compose.yml`, thư mục gốc `/`.
3. Ở service `app`, ô **Domains** điền tên miền kèm cổng nội bộ: `https://luong.ten-mien-cua-ban.vn:3000`. Phần `:3000` chỉ cho Coolify biết app nghe ở cổng nào, người dùng vẫn mở `https://luong.ten-mien-cua-ban.vn`.
4. Tab **Environment Variables**, đặt các biến:
   - `ADMIN_USERNAME`: tên đăng nhập của super admin. Bỏ trống thì là `admin`.
   - `ADMIN_PASSWORD`: mật khẩu super admin, ít nhất 12 ký tự. Đổi bất cứ lúc nào, không ảnh hưởng dữ liệu.
   - `SESSION_SECRET`: chuỗi ngẫu nhiên, ít nhất 32 ký tự. Lưu một bản ở nơi an toàn và không đổi sau khi đã dùng. Tạo bằng:

     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```

5. Bấm **Deploy**.
6. Mở `https://luong.ten-mien-cua-ban.vn/healthz`, thấy `{"ok":true}` là đã chạy.

Tên miền phải trỏ DNS về IP của server Coolify. App bắt buộc chạy qua HTTPS, vì trình duyệt chỉ cho mã hóa dữ liệu trên HTTPS. Mở bằng `http://địa-chỉ-ip` thì không đăng nhập được.

## 2. Tài khoản

Không có mật khẩu chung. Mỗi người đăng nhập bằng tên đăng nhập và mật khẩu riêng.

| Tài khoản | Tạo ở đâu | Quyền |
|---|---|---|
| Super admin | `ADMIN_USERNAME`, `ADMIN_PASSWORD` trong biến môi trường | Toàn quyền, thiết lập lần đầu, đặt lại mật khẩu của mọi người kể cả chủ |
| Chủ cửa hàng | Form thiết lập lần đầu | Toàn quyền trên dữ liệu, tạo và đặt lại tài khoản nhân viên |
| Nhân viên | Form thiết lập lần đầu, hoặc **Cài đặt** | Dữ liệu của chính mình, tự đổi mật khẩu |

Bắt đầu mới: mở trang, đăng nhập bằng super admin, điền form thiết lập lần đầu. Chỉ super admin làm được bước này.

**Quên mật khẩu:** đăng nhập bằng super admin, vào **Cài đặt**. Mục **Tài khoản chủ cửa hàng** đặt lại mật khẩu chủ, nút **Đặt lại mật khẩu** ở từng nhân viên đặt lại mật khẩu người đó.

## 3. Nâng cấp từ bản có mật khẩu cửa hàng

Dùng cách này nếu server đang chạy bản cũ có trang nhập mật khẩu cửa hàng.

1. Đăng nhập bản cũ bằng tài khoản chủ, vào **Cài đặt**, bấm **Tải file sao lưu**.
2. Trên Coolify, xóa `DOOR_PASSWORD`, thêm `ADMIN_USERNAME` và `ADMIN_PASSWORD`, rồi Redeploy.
3. Mở trang, đăng nhập bằng super admin, nhập mật khẩu chủ hiện tại một lần ở màn hình **Mở khóa dữ liệu**.
4. App tự mở **Cài đặt**. Tạo tài khoản cho chủ ở mục **Tài khoản chủ cửa hàng**. Mật khẩu chủ nhập ở đây thay cho mật khẩu cũ.
5. Bấm **Tạo tài khoản** ở từng nhân viên, chọn tên đăng nhập và mật khẩu mới rồi báo cho họ. Mật khẩu cũ của nhân viên không dùng được nữa vì máy chủ chưa từng có bằng chứng của mật khẩu đó.

## 4. Chuyển dữ liệu từ Claude sang

**Làm trước khi báo tài khoản cho nhân viên.**

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
7. Mở trang, đăng nhập bằng super admin, nhập mật khẩu chủ trên Claude một lần ở màn hình **Mở khóa dữ liệu**.
8. App tự mở **Cài đặt**. Tạo tài khoản cho chủ và từng nhân viên như bước 4 và 5 của phần Nâng cấp.
9. Kiểm tra số công và lương từng người, rồi báo địa chỉ và tài khoản cho nhân viên.

## Cập nhật app

Đẩy code mới lên nhánh `main` rồi bấm **Redeploy** trên Coolify, hoặc bật Auto Deploy. Dữ liệu nằm trên volume nên không mất khi deploy lại.

Không xóa volume `payroll-data` và không bật tùy chọn xóa volume khi xóa app, vì đó là toàn bộ dữ liệu.

## Sao lưu

Mất volume là mất toàn bộ chấm công và lương. Chủ nên vào **Cài đặt** bấm **Tải file sao lưu** hằng tháng rồi cất ở nơi an toàn. Nạp lại file đó bằng lệnh `node server/import.js <file> --force` trong container, lệnh này ghi đè dữ liệu đang có.

File sao lưu không chứa tài khoản đăng nhập. Nạp lại trên server cũ thì tài khoản giữ nguyên, nhưng ai đã đổi mật khẩu sau ngày sao lưu sẽ không mở được dữ liệu và cần được đặt lại mật khẩu. Nạp sang server mới thì tạo lại tài khoản như phần Chuyển dữ liệu.

## Bảo mật

| Lớp | Tác dụng |
|---|---|
| Tài khoản riêng | Chưa đăng nhập thì không đọc được gì, kể cả tên nhân viên và khóa đã bọc. Một tên đăng nhập sai 10 lần từ cùng địa chỉ IP thì khóa 15 phút. |
| Mã hóa trên trình duyệt | Máy chủ chỉ giữ bản đã mã hóa của lương, chấm công, tài khoản ngân hàng. Mật khẩu không gửi lên máy chủ, trình duyệt chỉ gửi bằng chứng dẫn xuất từ mật khẩu. |
| Phân quyền trên máy chủ | Nhân viên chỉ xem và ghi được dữ liệu của chính mình: chấm công, tài khoản ngân hàng, mật khẩu. Không tự sửa được lương, thưởng, doanh thu, cài đặt. |

Lưu ý:

- **Biến môi trường là chìa khóa của toàn bộ dữ liệu.** Ai có `SESSION_SECRET` và file database thì giải mã được tất cả, và ai có mật khẩu super admin thì xem được tất cả. Không commit `.env`, không gửi các giá trị này qua chat.
- **Nhân viên nghỉ việc:** đặt lại mật khẩu của người đó. Mọi phiên đăng nhập của họ hết hiệu lực ngay, trên mọi máy.
- **`SESSION_SECRET` đổi hoặc mất:** mọi người phải đăng nhập lại, và super admin cần nhập mật khẩu chủ một lần để gắn lại. Mất cả `SESSION_SECRET` lẫn mật khẩu chủ thì mất dữ liệu đã mã hóa.
- Doanh thu, tên nhân viên và trạng thái chốt lương không mã hóa, giống bản trên Claude.
