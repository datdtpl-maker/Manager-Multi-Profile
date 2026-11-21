# Manager Multi Profile

Desktop application (Electron + React + TypeScript + CloakBrowser) để quản lý nhiều profile trình duyệt, nhóm tài khoản, lưu database/cookies độc lập và cài đặt/cập nhật Chrome Extension hàng loạt.

## Tính năng chính
- **Quản lý Tài khoản & Nhóm Profile**: Tạo / đổi tên / xóa nhóm, thêm / sửa / xóa profile, tìm kiếm nhiều dòng, chuyển nhóm hàng loạt, menu chuột phải thao tác nhanh.
- **Lưu trữ Database & Cookies độc lập**: Lưu dữ liệu riêng (SQLite + thư mục `profiles/`, `cookies/`, `extensions/`, `backups/`), hỗ trợ đổi hoặc tạo file database mới.
- **Mở trình duyệt & Mở hàng loạt**: Mở từng profile hoặc mở hàng loạt nhiều profile với cấu hình URL lúc mở, chọn chế độ mở trực tiếp / nạp Cookie và độ trễ giữa mỗi profile.
- **Quản lý & Cập nhật Extension hàng loạt**: Thêm extension từ thư mục unpacked (`manifest.json`) hoặc `.zip`, có thanh trạng thái chống cài trùng trên từng profile, cập nhật ghi đè tại chỗ giữ nguyên Extension ID cho toàn bộ profile đang dùng.

## Cài đặt & Chạy phát triển
```bash
npm install
npm run dev
```

## Build & Đóng gói Windows (.exe)
```bash
npm run build
npm run dist:win
```
