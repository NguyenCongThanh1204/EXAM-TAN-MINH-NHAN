# Hệ thống thi trắc nghiệm trực tuyến an toàn

React + Vite + Tailwind (frontend) · Vercel Functions (API) · Supabase Postgres (dữ liệu, chấm điểm, khoá giao dịch).

## 1. Chạy cục bộ
1. `npm install`
2. Tạo project Supabase **dev**; chạy `supabase/migrations/001_init.sql` trong SQL Editor.
3. `cp .env.example .env.local`, điền giá trị (không bao giờ dùng tiền tố `VITE_` cho bí mật).
4. `npx vercel dev` (cần `APP_ORIGIN=http://localhost:3000`).

Admin và thí sinh dùng chung một website/domain. Trên Vercel, đặt `APP_ORIGIN` thành origin mà thí sinh mở, ví dụ `https://ten-mien.vercel.app` (chỉ giao thức + domain, không có dấu `/` cuối, path hoặc `#/admin`). Trang admin là cùng trang đó với hash `/#/admin`; không cần tạo domain admin riêng. API chấp nhận origin cấu hình hoặc origin khớp chính xác host hiện tại do Vercel chuyển tiếp, và từ chối domain khác. Nếu dùng nhiều domain chính thức, có thể khai báo danh sách origin cách nhau bằng dấu phẩy. Thay đổi biến môi trường Vercel cần redeploy để có hiệu lực.

## 2. Cấu hình kỳ thi (không hardcode)
Vào `#/admin`, mục **Cấu hình kỳ thi** để đặt tiêu đề, thời gian bắt đầu/kết thúc (giờ Việt Nam), thời lượng, số câu, ngưỡng đạt, logo, và bật/tắt: mở kỳ thi, yêu cầu mã mời, hiện điểm. Bấm **Lưu cấu hình**. Tắt "Mở kỳ thi" để đóng ngay lập tức.
(Có thể sửa trực tiếp bảng `exam_settings` trong Supabase nếu cần.)
Thay `public/logo.svg` bằng logo công ty nếu cần.
Hạn nộp = `LEAST(giờ bắt đầu theo server + duration, closing_at)`, tính trong DB (`start_attempt`).


## 3. Câu hỏi
Mỗi câu: 1 dòng `exam_questions` (`options` = `[{"id":"a","text":"..."},...]`) + 1 dòng `question_keys` (đáp án đúng, bảng này không bao giờ được trả về cho trình duyệt).
`supabase/seed_example_questions.sql` có 50 câu mẫu (đáp án luôn "a") để thử nghiệm — **phải thay bằng câu thật**. Cần đúng ≥ 50 câu `active`.

### Nhập câu hỏi bằng Excel hoặc Word (trang `#/admin`)
Chạy thêm `supabase/migrations/002_import.sql`. Trong mục "Nhập câu hỏi từ tệp": chọn **Excel** hoặc **Word**, chọn *Thay thế* hoặc *Thêm vào*, tải tệp mẫu, điền câu hỏi, bấm **Kiểm tra tệp** (xem trước + danh sách lỗi theo dòng/câu), rồi **Lưu vào hệ thống**.
- Excel: cột A câu hỏi, B–G đáp án A–F (liên tục, tối thiểu 2), H đáp án đúng (A–F). Hàng tiêu đề là tuỳ chọn. Chỉ đọc sheet đầu tiên.
- Word: mỗi câu gồm `1. Nội dung`, các dòng `A. …`, `B. …`, rồi `Đáp án: X`. Câu/đáp án có thể xuống dòng. Hình ảnh, bảng, công thức không được đọc.
- Việc nhập bị **khoá khi đã có bất kỳ bài thi nào** (kể cả thi thử): xoá thi thử bằng `delete from exam_attempts;` rồi nhập lại.
- Chỉ lưu khi toàn bộ tệp hợp lệ; việc lưu là một giao dịch DB duy nhất.

## 4. Mã mời (mã dùng chung)
Mở `https://<app>/#/admin`, mục **Mã mời dùng chung**: nhập **số người được dùng mã** (ví dụ 300) rồi bấm "Tạo mã mới". Hệ thống tạo **một mã duy nhất** cho tối đa 300 lượt thi; mỗi thí sinh vào thi thành công tốn một lượt. Mã chỉ hiển thị một lần; DB chỉ lưu HMAC. Panel hiển thị số lượt đã dùng / giới hạn.
Tạo mã mới sẽ **thu hồi mã cũ** (thí sinh đã thi bằng mã cũ không bị ảnh hưởng).
Nếu tắt mã mời (`invitation_required=false`) thì **không thể chống mạo danh/trùng lặp** chỉ bằng thông tin tự nhập.

## 5. Triển khai (Vercel)
1. Push lên Git, import vào Vercel (Framework: Vite).
2. Đặt biến môi trường như `.env.example` (Production ≠ Preview/Dev; dùng project Supabase riêng).
3. Chạy migration `002_import.sql` và `003_shared_code.sql` trên Supabase production, nhập câu hỏi, tạo mã, cập nhật cấu hình trong `#/admin`.
4. Kiểm tra: vào trang, thi thử bằng 1 mã, đăng nhập `#/admin`, tải Excel.
5. Backup: Supabase → Database → Backups, hoặc `pg_dump` trước/sau kỳ thi. Rollback: Vercel → Deployments → Promote bản trước.

## 6. Chính sách vận hành
- Chuyển tab/ẩn cửa sổ hoặc cửa sổ thi mất focus (`visibilitychange`/`blur`) → nộp bài ngay. Trang thi chặn chọn/copy/cut/paste, chuột phải và một số phím tắt ở mức trình duyệt. Đây chỉ là biện pháp cản trở: không thể ngăn chia đôi cùng cửa sổ, chụp ảnh màn hình, thiết bị khác hoặc người dùng vô hiệu hóa JavaScript; có thể nộp nhầm nếu hệ điều hành làm cửa sổ mất focus, vì vậy cần thông báo trước.
- Tải lại trang: giữ nguyên thứ tự câu và hạn nộp (lưu trong DB, cookie httpOnly). Mất mạng: client thử lại; quá hạn thì server tự chốt bằng các đáp án đã lưu khi bài được truy cập, hoặc khi bấm "Chốt các bài hết hạn" / tải Excel (tự chốt trước khi xuất).
- Không dùng cron (Vercel Hobby chỉ chạy 1 lần/ngày); luôn bấm "Chốt các bài hết hạn" sau 09:30.
- Excel chỉ gồm bài đã nộp/chốt, đúng 6 cột, chống formula injection, chỉ admin tải được. Trang quản trị có lựa chọn tải và giữ dữ liệu hoặc tải rồi xóa các lượt thi đã hoàn tất cùng câu trả lời/sự kiện liên quan. Chức năng xóa chỉ chạy khi kỳ thi đã đóng hoặc chưa kích hoạt và không còn bài đang làm; ngân hàng câu hỏi, cấu hình và lượt dùng mã mời được giữ nguyên. Nên sao lưu tệp Excel trước khi xóa.
- Giới hạn: không chống được điện thoại/máy thứ hai, chụp màn hình, trình duyệt bị sửa, mạo danh khi không có mã mời. Với kỳ thi quan trọng cần giám thị.
- Dữ liệu cá nhân: dùng nút **Tải Excel và xóa dữ liệu kết quả** sau kỳ thi theo chính sách lưu trữ của công ty; thao tác này cascade xóa đáp án/sự kiện nhưng không xóa ngân hàng câu hỏi, cấu hình hoặc lượt dùng mã mời.

## 7. Kiểm thử
`npm run typecheck && npm test && npm run build`.
Tải: `loadtest/k6.js` (300 VU) trên **staging**; ghi lại kết quả thực tế vào `docs/loadtest-results.md`.
