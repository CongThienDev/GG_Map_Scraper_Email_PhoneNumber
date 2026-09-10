# Thử nghiệm email extraction từ Kings_dentist.xlsx

Ngày kiểm tra: 10/09/2026. Đây là pilot chẩn đoán trên 10 hostname, không phải benchmark accuracy/recall của một bot hoàn chỉnh. File Excel nguồn được đọc, không chỉnh sửa. Các nội dung trong file và website được xử lý như dữ liệu, không phải chỉ dẫn thực thi.

## 1. Dữ liệu đầu vào

Sheet Leads có 1.147 bản ghi, hàng 2–1148; 13 cột. Cột B là tên, C địa chỉ, D điện thoại, E website, J City, K URL Maps, L–M tọa độ center.

| Chỉ số | Kết quả |
|---|---:|
| Dòng có website | 753 |
| Dòng không có website | 394 |
| Chuỗi URL website khác nhau, chưa canonicalize | 686 |
| Hostname khác nhau sau lowercase và bỏ www. | 554 |
| Nhóm số điện thoại không rỗng xuất hiện trên nhiều dòng | 174 |
| Dòng có chữ Brooklyn trong địa chỉ | 1.023 |
| Dòng có chữ New York trong địa chỉ, không có Brooklyn | 14 |

554 là số hostname, không phải số doanh nghiệp độc lập hay số registered domain. 174 nhóm trùng điện thoại là tín hiệu quan hệ, không đủ để xóa dòng. Bác sĩ và phòng khám có thể là hai listing hợp lệ.

Hostname lặp nhiều: dentalofficebrooklyn.com 18 dòng; diamondbraces.com 12; emergencydentalservice.com, centurymedicaldental.com và dentbenefits.com mỗi hostname 8. Cần cache theo website nhưng gán kết quả theo doanh nghiệp/chi nhánh.

City có thể là nhãn job tìm kiếm: hai dòng đầu có địa chỉ Manhattan dù City là Kings. Không dùng City làm bằng chứng xác nhận chi nhánh. Các trường center_lat/center_lng không nên mặc định là tọa độ doanh nghiệp; ngay dòng 2 chúng khác tọa độ nằm trong URL Maps.

## 2. Cách chọn mẫu và cách chạy

- Lấy bản ghi đầu tiên của từng hostname theo thứ tự sheet. Chọn 8 hostname bằng Python random.Random(20260910).sample; bổ sung dòng Excel 2 và 3 để kiểm tra hai website đầu file. Đây là mẫu khám phá có thể tái lập, không phải mẫu ngẫu nhiên thuần của mọi lead.
- HTTP: Python urllib + HTMLParser, 3 worker; tải URL đầu vào, tối đa 2 link Contact/Location/About tìm thấy trong HTML. Timeout mỗi request 15 giây, giới hạn đọc 2,5 MB. Có đọc robots.txt; script pilot chưa phải policy engine production.
- Lưu raw HTML, ứng viên regex, mailto, text, giải mã data-cfemail, URL redirect và thời gian.
- Chromium đi kèm Puppeteer của dự án không khởi động được: spawn Unknown system error -88. Không có kết quả timing browser tự động từ script browser.cjs.
- Thay thế bằng Codex in-app browser để đọc trang sau render trên 9 website truy cập được, có kiểm tra popup Email Us tại Midtown và trang chi nhánh cụ thể của Midtown/IAD. Không gửi form, không gửi email, không kiểm tra mailbox bằng SMTP.
- Thời gian browser qua thao tác công cụ không dùng so sánh tốc độ với HTTP. Bằng chứng browser được ghi trong phiên làm việc và tóm tắt dưới đây; chức năng export nội dung của in-app browser không được hỗ trợ trong phiên này.

## 3. Kết quả theo website

Số dòng dưới đây là hàng Excel, bao gồm hàng tiêu đề; không phải cột STT.

| Hàng | Doanh nghiệp | Kết quả | Nguồn và bằng chứng |
|---|---|---|---|
| 495 | 5th Avenue Dentistry and Implants | frontdesk@5thavedentistry.com — hiển thị công khai | [Contact](https://5thavedentistry.com/contact/): text và mailto; 7815 5th Avenue, (718) 745-4422 khớp sheet. Trang có số riêng cho bệnh nhân mới, nên không yêu cầu mọi số điện thoại phải giống nhau. |
| 113 | Midtown Dental Group Marine Park | marinepark@midtowndentalgroup.com — hiển thị công khai, đúng chi nhánh | [Marine Park](https://midtowndentalgroup.com/locations/marinepark/): email, 3605 Ave. S., (718) 339-6544 khớp. [Contact](https://midtowndentalgroup.com/contactus/) có popup Email Us; danh sách email ẩn trước khi mở nhưng là nội dung hợp lệ. HTML có data-cfemail. |
| 3 | Beam Dental Union Square | unionsquare@mybeamdental.com — ứng viên được schema hỗ trợ | [Union Square](https://www.mybeamdental.com/locations/union-square): JavaScript trong HTML chứa email; sau render có JSON-LD @type Dentist với email, địa chỉ 3 W 13th St Floor 1 và điện thoại (646) 590-7924 khớp. Không thấy email trong text hiển thị hoặc mailto; lưu evidence_class=structured_data, không gộp với visible_email. |
| 194 | Flatlands Family Dental | Chưa tìm thấy trong phạm vi kiểm tra | [Contact](https://flatlandsfamilydental.com/contact_us/): địa chỉ/điện thoại khớp, có form Send Us A Message; nhãn E-mail là trường người dùng điền, không phải email phòng khám. |
| 491 | Krietchman Raymond | Chưa tìm thấy trong phạm vi kiểm tra | [Contact](https://drkrietchman.com/contact.php): website nói gửi email bằng cách điền form; không công bố địa chỉ email trong nội dung đã đọc. Có hai địa điểm Brooklyn/Staten Island. |
| 282 | Dr. David S. Rogoff, DDS | Chưa tìm thấy trong phạm vi kiểm tra | [Contact](https://www.rogoffsdentalgroup.com/contact-us/): địa chỉ 115-08 Beach Channel Dr., Suite 103 và số (718) 318-3384 khớp; có điện thoại/fax/đường đi, không thấy email. |
| 20 | Brooklyn Dental PC | Chưa tìm thấy trong phạm vi kiểm tra | [Contact](https://www.brooklyndentalpc.com/contact-us/): địa chỉ 7 Bay 28th Street, Second Floor và (718) 333-9900 khớp; công bố call/text/fax, không thấy email. |
| 2 | Integrated Aesthetic Dentistry | Chưa tìm thấy trong phạm vi kiểm tra | [Upper East Side](https://www.iadentistry.com/contactus/upper-east-side-office/): 160 E 88th Street Suite 1A khớp; có form, không thấy email. Điện thoại trang là 212-427-4277, khác số Maps trong file; cần ghi nhận sai khác, chưa đủ kết luận sai doanh nghiệp. |
| 708 | Kensington Dental Office | Tên doanh nghiệp không khớp trên URL đặt lịch; cần review | [Weave URL trong file](https://book2.getweave.com/aacad472-2c9a-4eed-a5bb-b2fc98bb7e26/request-appointment?source=WEBSITE) sau tải hiển thị Williamsburg Smiles Family Dentistry và Roshanjit Butter. Chưa xác minh được quan hệ với Kensington. Không có email quan sát được. Không được tự gán email nhà cung cấp Weave. |
| 806 | Dental Fillings Brooklyn | Lỗi phân giải DNS trong môi trường kiểm tra | URL đầu vào http://dentalfillingsbrooklyn.net/ báo nodename nor servname provided, or not known. Chưa chứng minh domain chết ở mọi resolver hay mọi thời điểm. |

Tổng: 2/10 có email hiển thị được xác nhận theo doanh nghiệp/chi nhánh; thêm 1/10 có email schema khớp danh tính; 5/10 chưa tìm thấy; 1/10 tên không khớp; 1/10 lỗi DNS. Không suy ra recall 30%, precision 100% hoặc 70% website không có email từ các số này. Chưa kiểm tra khả năng nhận thư.

## 4. Số đo HTTP và giới hạn

Lượt HTTP ban đầu mất 20,046 giây wall-clock với 3 worker, bao gồm việc đọc robots: 23 lần truy cập trang, 22 HTTP 200, 1 lỗi DNS; chưa gồm 2 lần HTTP bổ sung cho Marine Park và IAD Upper East Side. Tổng body thành công 6.629.271 byte. Median thời gian request trang thành công 1,665 giây; lớn nhất 6,202 giây. Chỉ có một lượt chạy, không có cold/warm cache control, không suy rộng thành công suất VPS.

Trên chính tập trang ban đầu, parser text/mailto tìm email ở 1/10 website (5th Avenue). Các kênh mở rộng cung cấp email của Midtown và Beam. Đây là tăng số trường hợp có bằng chứng trong pilot, không phải phép đo recall trên ground truth đầy đủ.

Raw regex nhận nhầm đoạn /@40.730733 trong URL Maps là email, và ở Beam bắt cả dấu nháy đơn của JavaScript vào ứng viên. Cần tokenizer/parser theo nguồn và validator, không dùng regex toàn HTML làm đầu ra cuối cùng.

## 5. Những thay đổi nên ưu tiên khi xây bot

1. **Xác minh website và chi nhánh trước khi chấp nhận email.** Dùng tên, địa chỉ, điện thoại và URL chi nhánh. Nhận diện URL booking/directory riêng; chuyển mismatch sang review. Không tự loại khi chỉ lệch một số điện thoại.
2. **Khám phá theo chi nhánh.** Pilot ưu tiên contact/location đơn giản đã đi vào Fulton của IAD thay vì Upper East Side, và Edgewater của Beam thay vì Union Square. Chấm điểm link bằng chi nhánh đích, lưu nguyên URL path đầu vào, và dừng đúng lúc sẽ giảm cả lỗi lẫn request.
3. **Extractor nhiều kênh có provenance.** mailto, text theo DOM, JSON-LD, dữ liệu nhúng có cấu trúc, decoder Cloudflare; parser email xử lý encoding và ranh giới token. Với inline JavaScript, chỉ parse mẫu dữ liệu hẹp/AST tĩnh khi nhận diện được; fallback browser, không eval mã website trong worker.
4. **Visibility có trạng thái.** Popup Midtown chứng minh ẩn không đồng nghĩa honeypot. Đối chiếu sau thao tác Email Us, tránh loại mọi node ẩn; đồng thời loại placeholder john@doe.com quan sát trong form của Midtown.
5. **Các trạng thái kết quả trung thực.** found_visible, found_structured, not_found_within_budget, identity_review, fetch_error. Contact-form và phone-only là kênh quan sát được, chưa phải bằng chứng toàn website không có email.
6. **Cache theo hostname, kết quả theo lead/chi nhánh.** Với nền tảng multi-tenant như Weave, cần giữ tenant ID trong cache key; không gom tất cả tenant thành một doanh nghiệp. Không xóa các listing bác sĩ chỉ vì chung điện thoại.
7. **Browser fallback có ngân sách.** Mở đúng trang Contact/chi nhánh và thao tác liên hệ có căn cứ. Runtime cần health check launch/render trước khi chạy hàng loạt. Không cho lỗi browser trở thành not_found.
8. **OCR và giải mã phức tạp sau khi đo nhu cầu.** Pilot chưa phát hiện ca email ảnh, CSS đảo chữ hay honeypot được xác nhận. Chưa có cơ sở đặt chúng trước identity matching, schema và popup handling.

Kiến trúc đề xuất: importer chỉ đọc file → nhóm công việc và nhận diện website → HTTP discovery theo chi nhánh → candidate extraction với bằng chứng → xác minh danh tính/vai trò → browser khi còn thiếu → kết quả có trạng thái + audit. Worker HTTP/browser tách biệt, concurrency theo domain, retry hữu hạn, time/byte/page limits, chống SSRF và job có thể phục hồi.

## 6. Benchmark tiếp theo

- Dùng toàn bộ 554 hostname làm sampling frame; lấy 100–150 hostname mới để gán nhãn, giữ riêng pilot này như tập phát triển. Bổ sung nhiều bản ghi chi nhánh trên hostname chuỗi để đo attribution.
- Gán nhãn theo phạm vi đã duyệt, ghi thao tác và nguồn; không coi kết quả rỗng của bot là ground truth. Các ca chưa xác định giữ unknown.
- Giữ doanh nghiệp/chuỗi liên quan trong cùng partition. Tách mẫu đại diện và bộ ca khó tổng hợp; không trộn để tạo một accuracy đẹp.
- So sánh cùng trang, cùng máy và ngân sách: text/mailto; thêm schema/decoder; thêm discovery theo chi nhánh; thêm browser. Đo browser render-only và render+interaction riêng.
- Chỉ số chính: precision accepted email; branch accuracy; tỷ lệ tìm được email trên website có email đã xác nhận; tỷ lệ trả nhầm trên mẫu âm đã kiểm tra; unknown/review/error; request và giây/email đúng. Báo khoảng tin cậy khi mẫu đủ, không chỉ point estimate.
- Bộ regression từ pilot: tọa độ @ trong Maps; dấu nháy JS ở Beam; JSON-LD động; Cloudflare decoder; popup ẩn hợp lệ; sai chi nhánh; placeholder trong iframe; URL booking sai tên; DNS failure; số điện thoại tracking khác nhau.

Quyết định thực dụng: triển khai identity/branch matching, schema và decoder trước; browser tương tác tiếp theo; dùng kết quả benchmark mới quyết định đầu tư OCR/AI sâu. Không có bằng chứng từ pilot này cho lời hứa lấy được email trên mọi website.
