# Hệ thống thi trắc nghiệm trực tuyến an toàn

React + Vite + Tailwind (frontend) · Vercel Functions (API) · Supabase Postgres (dữ liệu, chấm điểm, khoá giao dịch).

## 1. Chạy cục bộ
1. `npm install`
2. Tạo project Supabase **dev**; chạy các migration trong `supabase/migrations/` theo thứ tự tên tệp từ `001` đến mới nhất trong SQL Editor.
3. `cp .env.example .env.local`, điền giá trị (không bao giờ dùng tiền tố `VITE_` cho bí mật).
4. `npx vercel dev` (cần `APP_ORIGIN=http://localhost:3000`).

Admin và thí sinh dùng chung một website/domain. Trên Vercel, đặt `APP_ORIGIN` thành origin mà thí sinh mở, ví dụ `https://ten-mien.vercel.app` (chỉ giao thức + domain, không có dấu `/` cuối, path hoặc `#/admin`). Trang admin là cùng trang đó với hash `/#/admin`; không cần tạo domain admin riêng. API chấp nhận origin cấu hình hoặc origin khớp chính xác host hiện tại do Vercel chuyển tiếp, và từ chối domain khác. Nếu dùng nhiều domain chính thức, có thể khai báo danh sách origin cách nhau bằng dấu phẩy. Thay đổi biến môi trường Vercel cần redeploy để có hiệu lực.

## 2. Cấu hình kỳ thi (không hardcode)
Vào `#/admin` (giao diện chia tab Cấu hình / Mã mời / Câu hỏi / Kết quả), tab **Cấu hình** để đặt tiêu đề, thời gian bắt đầu/kết thúc (giờ Việt Nam), thời lượng, số câu trắc nghiệm và số câu tự luận riêng (mỗi loại có thể đặt 0; tổng phải từ 1 đến 1.000), **điểm đạt trên thang 10**, **cách hiển thị bài làm** (từng câu một hoặc hiện tất cả câu cùng lúc) và bật/tắt: mở kỳ thi, yêu cầu mã mời, hiện điểm. Tại **Danh sách công trình**, có thể thêm, ẩn/kích hoạt hoặc xóa công trình chưa từng được dùng. Công trình đã gắn với bài thi cũ chỉ có thể ẩn, không xóa, để giữ lịch sử và thống kê. Danh sách dài có thanh cuộn riêng. Logo dùng mặc định `/logo.png`, không cấu hình trong giao diện. Bấm **Lưu cấu hình**. Tắt "Mở kỳ thi" để đóng ngay lập tức. Mọi xác nhận/thông báo dùng hộp thoại và toast của ứng dụng, không dùng hộp thoại mặc định của trình duyệt.
(Có thể sửa trực tiếp bảng `exam_settings` trong Supabase nếu cần.)
Thay `public/logo.png` bằng logo công ty nếu cần.
Hạn nộp = `LEAST(giờ bắt đầu theo server + duration, closing_at)`, tính trong DB (`start_attempt`).

Trong tab **Kết quả**, dashboard thống kê các bài đã nộp (không tính bài đang làm), có thể lọc theo công trình, cấp bậc và khoảng điểm trên thang 10. Chỉ số vi phạm chuyển tab luôn hiển thị số lượt vi phạm trên tổng số lượt đã nộp và tỷ lệ tương ứng, không phụ thuộc các bộ lọc hay kết quả đậu/rớt. Biểu đồ vòng thể hiện tỷ lệ đạt/không đạt; biểu đồ cột thể hiện phân bố điểm; biểu đồ thanh so sánh tỷ lệ đạt theo công trình hoặc cấp bậc. Điểm trung bình được tính từ phần trắc nghiệm đã chấm tự động; bài chưa có kết quả được thống kê riêng.

## 3. Câu hỏi
Mỗi câu có loại `single` (một đáp án), `multiple` (chọn nhiều đáp án, phải khớp chính xác toàn bộ đáp án đúng) hoặc `essay` (tự luận chấm thủ công trong Excel). Mỗi câu trắc nghiệm có 1 điểm nội bộ, nhưng hệ thống tự quy đổi điểm trắc nghiệm về thang 10 dựa trên số câu trắc nghiệm thực tế của đề. Vì vậy, nếu đề có 20 câu thì mỗi câu đúng tương đương 0,5 điểm; không cần tự đổi điểm khi nhập câu hỏi. Ngưỡng đạt cũng nhập trực tiếp theo thang 10 (ví dụ 7,5/10). Chỉ câu tự luận có điểm tối đa riêng. Hệ thống chọn ngẫu nhiên tối đa số câu trắc nghiệm và tự luận đã cấu hình theo từng loại; nếu ngân hàng một loại có ít câu hơn thì lấy toàn bộ câu loại đó đang hoạt động. Câu tự luận luôn được xếp cuối đề. Cần ít nhất một câu hoạt động để bắt đầu thi. Đáp án và đáp án tham khảo chỉ được admin truy cập, không gửi cho trình duyệt thí sinh.
Sau khi chạy migration `004_question_types_and_essays.sql`, `supabase/seed_example_questions.sql` có 50 câu mẫu (đáp án luôn "a") để thử nghiệm — **phải thay bằng câu thật**. Nếu ngân hàng có ít câu hơn số đã cấu hình ở một loại, hệ thống sẽ chọn toàn bộ câu đang hoạt động thuộc loại đó.

### Nhập câu hỏi bằng Excel hoặc Word (trang `#/admin`)
Trong mục "Nhập câu hỏi từ tệp": chọn **Excel** hoặc **Word**, chọn *Thay thế* hoặc *Thêm vào*, tải tệp mẫu, điền câu hỏi, bấm **Kiểm tra tệp** (xem trước + lỗi theo dòng/câu), rồi **Lưu vào hệ thống**.
- Excel: A câu hỏi, B–G lựa chọn A–F, H đáp án đúng (`A` hoặc `A,C`), I loại (`single`, `multiple`, `essay`), J điểm tối đa (chỉ áp dụng cho tự luận; trắc nghiệm tự quy đổi về thang 10), K đáp án tham khảo cho tự luận. I mặc định `single`. Câu tự luận bỏ trống B–H và cần đáp án tham khảo. Chỉ đọc sheet đầu tiên.
- Word: bắt đầu câu bằng `1. Nội dung`; thêm `Loại: single|multiple|essay`, `Điểm: 5` (chỉ cho tự luận); lựa chọn dùng `A. …`; đáp án trắc nghiệm dùng `Đáp án: A,C`; câu tự luận dùng `Đáp án tham khảo: ...`. Loại mặc định là `single`. Câu/đáp án có thể xuống dòng. Hình ảnh, bảng, công thức không được đọc.
- Việc nhập bị **khoá khi đã có bất kỳ bài thi nào** (kể cả thi thử): xoá thi thử bằng `delete from exam_attempts;` rồi nhập lại.
- Chỉ lưu khi toàn bộ tệp hợp lệ; việc lưu là một giao dịch DB duy nhất.

Người dự thi bắt buộc nhập họ tên, email công ty có đuôi `@tanminhnhan.com.vn`, chức danh/vị trí, cấp bậc và chọn công trình chính trong danh mục; trước khi bắt đầu cần xác nhận đã đọc và đồng ý tuân thủ nội quy. Giao diện và API đều kiểm tra miền email và công trình. Mỗi email chỉ được bắt đầu một lượt thi; hệ thống khóa kiểm tra này trong giao dịch DB để ngăn yêu cầu đồng thời dùng cùng địa chỉ. Khi thí sinh bấm bắt đầu, ứng dụng yêu cầu trình duyệt mở toàn màn hình; nếu không bật được, có thể nhấn F11. Khi cửa sổ mất focus hoặc trang thi bị ẩn trong lúc bật chế độ chống chuyển tab, bài thi tự động nộp. Nếu cấu hình bật **Hiện điểm**, điểm trắc nghiệm được hiển thị sau khi nộp; nếu tắt, thí sinh thấy lời cảm ơn kèm tiêu đề bài kiểm tra. Sau khi nộp, thí sinh có thể tải PDF bài làm của mình, gồm nội dung câu hỏi và lựa chọn/bài làm đã nộp, không kèm đáp án chuẩn. Tất cả PDF bài làm/hồ sơ có logo công ty ở góc trên trái; nếu bài bị nộp tự động do chuyển tab, PDF ghi rõ vi phạm ở góc trên phải. Trong khi thi, đáp án hiển thị ngay và được giữ thành bản nháp trong `localStorage`; hệ thống gửi lô tối đa 5 câu khi đủ thay đổi hoặc sau 120 giây kể từ thay đổi đầu tiên chưa đồng bộ. Khi nộp, các đáp án chưa đồng bộ phải được server xác nhận trước khi chốt bài; DB mới là nguồn dữ liệu chính thức. Câu tự luận được chấm bên ngoài ứng dụng: tải ZIP kết quả, mở workbook Excel, xem bài làm và đáp án tham khảo trong sheet **Kết quả tự luận**, rồi nhập điểm vào cột **Điểm giám khảo chấm** (0 đến điểm tối đa); ứng dụng không lưu điểm tự chấm.

## 4. Mã mời (mã dùng chung)
Mở `https://<app>/#/admin`, mục **Mã mời dùng chung**: nhập **số người được dùng mã** (ví dụ 300) rồi bấm "Tạo mã mới". Hệ thống tạo **một mã duy nhất** cho tối đa 300 lượt thi; mỗi thí sinh vào thi thành công tốn một lượt. Mã chỉ hiển thị một lần; DB chỉ lưu HMAC. Panel hiển thị số lượt đã dùng / giới hạn.
Tạo mã mới sẽ **thu hồi mã cũ** (thí sinh đã thi bằng mã cũ không bị ảnh hưởng).
Nếu tắt mã mời (`invitation_required=false`) thì **không thể chống mạo danh/trùng lặp** chỉ bằng thông tin tự nhập.

## 5. Triển khai (Vercel)
1. Push lên Git, import vào Vercel (Framework: Vite).
2. Đặt biến môi trường như `.env.example` (Production ≠ Preview/Dev; dùng project Supabase riêng).
3. Chạy tất cả migration trong `supabase/migrations/` theo thứ tự tên tệp, đến `020_batched_answer_saving.sql`, trên Supabase của môi trường tương ứng trước khi deploy code gọi RPC mới. Nhập câu hỏi, thêm danh sách công trình trong `#/admin` rồi cập nhật cấu hình. Production và staging phải dùng project Supabase riêng.
4. Kiểm tra: vào trang, thi thử bằng 1 mã, đăng nhập `#/admin`, tải ZIP hồ sơ.
5. Backup: Supabase → Database → Backups, hoặc `pg_dump` trước/sau kỳ thi. Rollback: Vercel → Deployments → Promote bản trước.

## 6. Chính sách vận hành
- Khi bảo vệ đang bật, chuyển tab/ẩn trang (`visibilitychange`) hoặc cửa sổ thi mất focus (`blur`) → nộp bài tự động; mất focus được xác nhận sau 300 ms để tránh sự kiện thoáng qua.  trạng thái được hiển thị rõ trên màn hình và không đổi cấu hình chung. Không sử dụng chế độ thử trong kỳ thi thật. Trang thi chặn chọn/copy/cut/paste, chuột phải và một số phím tắt ở mức trình duyệt. Đây chỉ là biện pháp cản trở: không thể ngăn chia đôi cùng cửa sổ, chụp ảnh màn hình, thiết bị khác hoặc người dùng vô hiệu hóa JavaScript; có thể nộp nhầm khi hệ điều hành làm cửa sổ mất focus, vì vậy cần thông báo trước.
- Tải lại trang: giữ nguyên thứ tự câu và hạn nộp (lưu trong DB, cookie httpOnly); đáp án chưa đồng bộ được khôi phục từ bản nháp `localStorage` theo mã lượt thi. Mỗi thay đổi cập nhật bản nháp ngay, gửi theo lô tối đa 5 câu khi đủ 5 câu thay đổi hoặc sau 120 giây kể từ thay đổi đầu tiên chưa đồng bộ; lỗi mạng thì giữ bản nháp và thử lại. Khi nộp, client chờ đồng bộ các đáp án còn lại trước khi yêu cầu server chốt bài. DB vẫn là nguồn dữ liệu chính thức. Quá hạn thì server tự chốt bằng các đáp án đã lưu khi bài được truy cập, hoặc khi bấm "Chốt các bài hết hạn" / tải Excel (tự chốt trước khi xuất).
- Không dùng cron (Vercel Hobby chỉ chạy 1 lần/ngày); luôn bấm "Chốt các bài hết hạn" sau 09:30.
- Tải kết quả tạo một file ZIP gồm workbook Excel và thư mục `pdfs/` với một phiếu PDF cho mỗi thí sinh đã nộp. Tên PDF theo dạng `0001_Ten_ThiSinh_Ten_CongTrinh.pdf` (số thứ tự ở đầu tên). Workbook có 4 sheet: **Kết quả trắc nghiệm** (mỗi thí sinh một dòng: thông tin, thời gian bắt đầu/kết thúc/thời lượng làm bài, số câu đúng, điểm trắc nghiệm quy đổi trên thang 10, ĐẠT/KHÔNG ĐẠT, tổng điểm tự luận tính từ sheet 2), **Kết quả tự luận** (bài làm, đáp án tham khảo và ô nhập điểm giám khảo), **Hồ sơ phúc khảo** (thông tin thí sinh và liên kết tới PDF tương ứng trong ZIP) và **Đáp án** (đáp án chuẩn và đáp án tham khảo). Phiếu PDF có thông tin/thời gian thi và từng câu hỏi; lựa chọn thí sinh đã chọn được tô xanh nếu đúng hoặc đỏ nếu sai. Nếu thí sinh trả lời sai hoặc chọn thiếu/thừa đáp án, PDF hiển thị thêm các chữ cái đáp án đúng ngay dưới các lựa chọn; câu trả lời đúng hoàn toàn không có dòng này. Phần tự luận chỉ hiển thị bài làm thí sinh. PDF dùng Tinos, phông serif tương thích Times New Roman, kết hợp các bộ ký tự Latin mở rộng và tiếng Việt (nội dung 13pt); đây không phải tệp Times New Roman thương mại. Chỉ admin tải được. Trang quản trị có lựa chọn tải và giữ dữ liệu hoặc tải rồi xóa các lượt thi đã hoàn tất cùng câu trả lời/sự kiện liên quan. Chức năng xóa chỉ chạy khi kỳ thi đã đóng hoặc chưa kích hoạt và không còn bài đang làm; ngân hàng câu hỏi, cấu hình và lượt dùng mã mời được giữ nguyên. Nên tải và lưu file ZIP an toàn trước khi xóa.
- Giới hạn: không chống được điện thoại/máy thứ hai, chụp màn hình, trình duyệt bị sửa, mạo danh khi không có mã mời. Với kỳ thi quan trọng cần giám thị.
- Dữ liệu cá nhân: dùng nút **Tải ZIP và xóa dữ liệu kết quả** sau kỳ thi theo chính sách lưu trữ của công ty; thao tác này cascade xóa đáp án/sự kiện nhưng không xóa ngân hàng câu hỏi, cấu hình hoặc lượt dùng mã mời.

## 7. Kiểm thử
`npm run typecheck && npm test && npm run build`.

### Load test với k6 (chỉ chạy trên staging)
Bảo đảm kỳ thi staging đang mở, có đủ 20 câu và công trình đã chọn đang hoạt động. Chuẩn bị một email test mới cho mỗi VU trong allowlist. Có thể đặt mỗi email một dòng trong `loadtest/participants.local.txt`; tệp này bị loại khỏi Git.
```powershell
k6 run -e BASE=https://staging.example.com -e ORIGIN=https://staging.example.com -e EMAIL_FILE=participants.local.txt -e PROJECT="KHU VỰC ĐÀ NẴNG" -e VUS=171 -e JITTER_SECONDS=20 .\loadtest\k6.js
```
Mỗi VU tạo và nộp một lượt thi; đáp án được gửi theo lô 5 câu. `VUS` tối đa 199. `EMAIL_FILE` được mở tương đối với thư mục `loadtest`; `PROJECT` phải khớp tên công trình đang hoạt động. `JITTER_SECONDS=0` tạo burst bắt đầu gần như đồng thời; đặt `20` để dàn lượt bắt đầu trong tối đa 20 giây. Mỗi email chỉ thi được một lần, vì vậy không dùng lại email test nếu lượt thi đã được tạo. Không chạy trên production.

Ngưỡng mặc định: tỷ lệ check trên 99%, lỗi request dưới 1%, p95 dưới 800 ms và p99 dưới 2 giây. Một lần chạy có thể tạo dữ liệu thi thử trong staging; kiểm tra và dọn dữ liệu theo quy trình staging trước khi chạy lại. Không chạy trên production.
