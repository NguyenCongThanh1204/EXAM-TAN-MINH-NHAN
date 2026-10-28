# Hệ thống thi trắc nghiệm trực tuyến an toàn

React + Vite + Tailwind (frontend) · Vercel Functions (API) · Supabase Postgres (dữ liệu, chấm điểm, khoá giao dịch).

## 1. Chạy cục bộ
1. `npm install`
2. Tạo project Supabase **dev**; chạy `supabase/migrations/001_init.sql` trong SQL Editor.
3. `cp .env.example .env.local`, điền giá trị (không bao giờ dùng tiền tố `VITE_` cho bí mật).
4. `npx vercel dev` (cần `APP_ORIGIN=http://localhost:3000`).

Admin và thí sinh dùng chung một website/domain. Trên Vercel, đặt `APP_ORIGIN` thành origin mà thí sinh mở, ví dụ `https://ten-mien.vercel.app` (chỉ giao thức + domain, không có dấu `/` cuối, path hoặc `#/admin`). Trang admin là cùng trang đó với hash `/#/admin`; không cần tạo domain admin riêng. API chấp nhận origin cấu hình hoặc origin khớp chính xác host hiện tại do Vercel chuyển tiếp, và từ chối domain khác. Nếu dùng nhiều domain chính thức, có thể khai báo danh sách origin cách nhau bằng dấu phẩy. Thay đổi biến môi trường Vercel cần redeploy để có hiệu lực.

## 2. Cấu hình kỳ thi (không hardcode)
Vào `#/admin` (giao diện chia tab Cấu hình / Mã mời / Câu hỏi / Kết quả), tab **Cấu hình** để đặt tiêu đề, thời gian bắt đầu/kết thúc (giờ Việt Nam), thời lượng, số câu trắc nghiệm và số câu tự luận riêng (mỗi loại có thể đặt 0; tổng phải từ 1 đến 1.000), ngưỡng đạt, **cách hiển thị bài làm** (từng câu một hoặc hiện tất cả câu cùng lúc) và bật/tắt: mở kỳ thi, yêu cầu mã mời, hiện điểm. Logo dùng mặc định `/logo.png`, không cấu hình trong giao diện. Bấm **Lưu cấu hình**. Tắt "Mở kỳ thi" để đóng ngay lập tức. Mọi xác nhận/thông báo dùng hộp thoại và toast của ứng dụng, không dùng hộp thoại mặc định của trình duyệt.
(Có thể sửa trực tiếp bảng `exam_settings` trong Supabase nếu cần.)
Thay `public/logo.png` bằng logo công ty nếu cần.
Hạn nộp = `LEAST(giờ bắt đầu theo server + duration, closing_at)`, tính trong DB (`start_attempt`).


## 3. Câu hỏi
Mỗi câu có loại `single` (một đáp án), `multiple` (chọn nhiều đáp án, phải khớp chính xác toàn bộ đáp án đúng) hoặc `essay` (tự luận chấm thủ công trong Excel). Mỗi câu trắc nghiệm luôn 1 điểm (kể cả nhiều đáp án) và được chấm, hiển thị điểm ngay khi thí sinh nộp bài; chỉ câu tự luận có điểm tối đa riêng. Hệ thống chọn ngẫu nhiên tối đa số câu trắc nghiệm và tự luận đã cấu hình theo từng loại; nếu ngân hàng một loại có ít câu hơn thì lấy toàn bộ câu loại đó đang hoạt động. Câu tự luận luôn được xếp cuối đề. Cần ít nhất một câu hoạt động để bắt đầu thi. Đáp án và đáp án tham khảo chỉ được admin truy cập, không gửi cho trình duyệt thí sinh.
Sau khi chạy migration `004_question_types_and_essays.sql`, `supabase/seed_example_questions.sql` có 50 câu mẫu (đáp án luôn "a") để thử nghiệm — **phải thay bằng câu thật**. Nếu ngân hàng có ít câu hơn số đã cấu hình ở một loại, hệ thống sẽ chọn toàn bộ câu đang hoạt động thuộc loại đó.

### Nhập câu hỏi bằng Excel hoặc Word (trang `#/admin`)
Trong mục "Nhập câu hỏi từ tệp": chọn **Excel** hoặc **Word**, chọn *Thay thế* hoặc *Thêm vào*, tải tệp mẫu, điền câu hỏi, bấm **Kiểm tra tệp** (xem trước + lỗi theo dòng/câu), rồi **Lưu vào hệ thống**.
- Excel: A câu hỏi, B–G lựa chọn A–F, H đáp án đúng (`A` hoặc `A,C`), I loại (`single`, `multiple`, `essay`), J điểm tối đa (chỉ áp dụng cho tự luận; trắc nghiệm luôn 1 điểm), K đáp án tham khảo cho tự luận. I mặc định `single`. Câu tự luận bỏ trống B–H và cần đáp án tham khảo. Chỉ đọc sheet đầu tiên.
- Word: bắt đầu câu bằng `1. Nội dung`; thêm `Loại: single|multiple|essay`, `Điểm: 5` (chỉ cho tự luận); lựa chọn dùng `A. …`; đáp án trắc nghiệm dùng `Đáp án: A,C`; câu tự luận dùng `Đáp án tham khảo: ...`. Loại mặc định là `single`. Câu/đáp án có thể xuống dòng. Hình ảnh, bảng, công thức không được đọc.
- Việc nhập bị **khoá khi đã có bất kỳ bài thi nào** (kể cả thi thử): xoá thi thử bằng `delete from exam_attempts;` rồi nhập lại.
- Chỉ lưu khi toàn bộ tệp hợp lệ; việc lưu là một giao dịch DB duy nhất.

Người dự thi bắt buộc nhập họ tên, email công ty có đuôi `@tanminhnhan.com.vn`, chức danh/vị trí, cấp bậc và công trình chính; giao diện và API đều kiểm tra miền email này. Trắc nghiệm được chấm và hiện điểm ngay khi nộp bài. Sau khi nộp, thí sinh có thể tải PDF bài làm của mình, gồm nội dung câu hỏi và lựa chọn/bài làm đã nộp, không kèm đáp án chuẩn. Tất cả PDF bài làm/hồ sơ có logo công ty ở góc trên trái; nếu bài bị nộp tự động do chuyển tab, PDF ghi rõ vi phạm ở góc trên phải. Câu tự luận được chấm bên ngoài ứng dụng: tải ZIP kết quả, mở workbook Excel, xem bài làm và đáp án tham khảo trong sheet **Kết quả tự luận**, rồi nhập điểm vào cột **Điểm giám khảo chấm** (0 đến điểm tối đa); ứng dụng không lưu điểm tự chấm.

## 4. Mã mời (mã dùng chung)
Mở `https://<app>/#/admin`, mục **Mã mời dùng chung**: nhập **số người được dùng mã** (ví dụ 300) rồi bấm "Tạo mã mới". Hệ thống tạo **một mã duy nhất** cho tối đa 300 lượt thi; mỗi thí sinh vào thi thành công tốn một lượt. Mã chỉ hiển thị một lần; DB chỉ lưu HMAC. Panel hiển thị số lượt đã dùng / giới hạn.
Tạo mã mới sẽ **thu hồi mã cũ** (thí sinh đã thi bằng mã cũ không bị ảnh hưởng).
Nếu tắt mã mời (`invitation_required=false`) thì **không thể chống mạo danh/trùng lặp** chỉ bằng thông tin tự nhập.

## 5. Triển khai (Vercel)
1. Push lên Git, import vào Vercel (Framework: Vite).
2. Đặt biến môi trường như `.env.example` (Production ≠ Preview/Dev; dùng project Supabase riêng).
3. Chạy migration theo thứ tự `001_init.sql` đến `010_default_logo_png.sql` trên Supabase production, nhập câu hỏi, tạo mã, cập nhật cấu hình trong `#/admin`. Nếu database đã có migration 009, chỉ cần chạy `010_default_logo_png.sql` để đặt logo mặc định thành `/logo.png`.
4. Kiểm tra: vào trang, thi thử bằng 1 mã, đăng nhập `#/admin`, tải ZIP hồ sơ.
5. Backup: Supabase → Database → Backups, hoặc `pg_dump` trước/sau kỳ thi. Rollback: Vercel → Deployments → Promote bản trước.

## 6. Chính sách vận hành
- Chuyển tab/ẩn cửa sổ hoặc cửa sổ thi mất focus (`visibilitychange`/`blur`) → nộp bài ngay. Trang thi chặn chọn/copy/cut/paste, chuột phải và một số phím tắt ở mức trình duyệt. Đây chỉ là biện pháp cản trở: không thể ngăn chia đôi cùng cửa sổ, chụp ảnh màn hình, thiết bị khác hoặc người dùng vô hiệu hóa JavaScript; có thể nộp nhầm nếu hệ điều hành làm cửa sổ mất focus, vì vậy cần thông báo trước.
- Tải lại trang: giữ nguyên thứ tự câu và hạn nộp (lưu trong DB, cookie httpOnly). Mất mạng: client thử lại; quá hạn thì server tự chốt bằng các đáp án đã lưu khi bài được truy cập, hoặc khi bấm "Chốt các bài hết hạn" / tải Excel (tự chốt trước khi xuất).
- Không dùng cron (Vercel Hobby chỉ chạy 1 lần/ngày); luôn bấm "Chốt các bài hết hạn" sau 09:30.
- Tải kết quả tạo một file ZIP gồm workbook Excel và thư mục `pdfs/` với một phiếu PDF cho mỗi thí sinh đã nộp. Tên PDF theo dạng `0001_Ten_ThiSinh_Ten_CongTrinh.pdf` (số thứ tự ở đầu tên). Workbook có 4 sheet: **Kết quả trắc nghiệm** (mỗi thí sinh một dòng: thông tin, thời gian bắt đầu/kết thúc/thời lượng làm bài, số câu đúng, điểm 1 điểm/câu, ĐẠT/KHÔNG ĐẠT, tổng điểm tự luận tính từ sheet 2), **Kết quả tự luận** (bài làm, đáp án tham khảo và ô nhập điểm giám khảo), **Hồ sơ phúc khảo** (thông tin thí sinh và liên kết tới PDF tương ứng trong ZIP) và **Đáp án** (đáp án chuẩn và đáp án tham khảo). Phiếu PDF có thông tin/thời gian thi và từng câu hỏi; lựa chọn thí sinh đã chọn được tô xanh nếu đúng hoặc đỏ nếu sai. Nếu thí sinh trả lời sai hoặc chọn thiếu/thừa đáp án, PDF hiển thị thêm các chữ cái đáp án đúng ngay dưới các lựa chọn; câu trả lời đúng hoàn toàn không có dòng này. Phần tự luận chỉ hiển thị bài làm thí sinh. PDF dùng Tinos, phông serif tương thích Times New Roman, kết hợp các bộ ký tự Latin mở rộng và tiếng Việt (nội dung 13pt); đây không phải tệp Times New Roman thương mại. Chỉ admin tải được. Trang quản trị có lựa chọn tải và giữ dữ liệu hoặc tải rồi xóa các lượt thi đã hoàn tất cùng câu trả lời/sự kiện liên quan. Chức năng xóa chỉ chạy khi kỳ thi đã đóng hoặc chưa kích hoạt và không còn bài đang làm; ngân hàng câu hỏi, cấu hình và lượt dùng mã mời được giữ nguyên. Nên tải và lưu file ZIP an toàn trước khi xóa.
- Giới hạn: không chống được điện thoại/máy thứ hai, chụp màn hình, trình duyệt bị sửa, mạo danh khi không có mã mời. Với kỳ thi quan trọng cần giám thị.
- Dữ liệu cá nhân: dùng nút **Tải ZIP và xóa dữ liệu kết quả** sau kỳ thi theo chính sách lưu trữ của công ty; thao tác này cascade xóa đáp án/sự kiện nhưng không xóa ngân hàng câu hỏi, cấu hình hoặc lượt dùng mã mời.

## 7. Kiểm thử
`npm run typecheck && npm test && npm run build`.

### Load test với k6 (chỉ chạy trên staging)
Bảo đảm kỳ thi staging đang mở và có đủ câu hỏi. Nếu bật yêu cầu mã, tạo một mã mời dùng chung còn ít nhất 400 lượt. Nếu tắt yêu cầu mã, chạy không cần tạo mã:
```powershell
k6 run -e BASE=https://staging.example.com -e ORIGIN=https://staging.example.com -e VUS=400 -e CODE_REQUIRED=false -e JITTER_SECONDS=0 .\loadtest\k6.js
```
Mỗi VU tạo một lượt thi, trả lời toàn bộ câu hỏi rồi nộp bài. Khi bật mã, thêm `-e CODE=YOUR_SHARED_TEST_CODE` (hoặc dùng `loadtest/codes.json` với một mã mỗi VU). `JITTER_SECONDS=0` tạo burst bắt đầu gần như đồng thời; đặt `20` để dàn lượt bắt đầu trong tối đa 20 giây. Không chạy trên production.

Lưu ý: API giới hạn bắt đầu ở **200 lượt/phút/IP**. Khi bật mã mời, còn có giới hạn thử mã **60 lượt/10 phút/IP**. Vì vậy một máy/IP chạy 400 VU sẽ bị rate-limit ngay cả khi tắt yêu cầu mã; để đo 400 lượt bắt đầu thành công, dùng nhiều máy/IP hoặc chỉ tạm điều chỉnh giới hạn start trong staging rồi khôi phục ngay sau thử nghiệm. Không nới giới hạn production.
Tải: `loadtest/k6.js` (300 VU) trên **staging**; ghi lại kết quả thực tế vào `docs/loadtest-results.md`.
