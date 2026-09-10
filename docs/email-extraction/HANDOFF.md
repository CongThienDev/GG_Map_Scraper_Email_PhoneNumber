# Bàn giao bot extract email từ website Google Maps

## Người dùng muốn đạt điều gì?

Đã có dữ liệu doanh nghiệp và website crawl từ Google Maps. Muốn xây bot lấy email nhanh, đúng, xử lý được website render JavaScript/bundle, email viết rời/mã hóa/ẩn và honeypot, có benchmark đầy đủ. Người dùng đã yêu cầu suy nghĩ kỹ, đọc tài liệu hiện tại trên mạng, rồi cung cấp file thực tế để thử một số website trước khi quyết định thiết kế.

Yêu cầu gần nhất là ghi toàn bộ context vào docs để clone dự án sang máy khác tiếp tục. Bốn yêu cầu người dùng và ba câu trả lời đầy đủ trước yêu cầu lưu docs nằm nguyên văn trong CHAT_SESSION.md.

## Trạng thái thật của dự án trong phiên này

- Đã nghiên cứu kiến trúc, đọc package.json, phân tích workbook, viết/chạy script HTTP pilot và kiểm tra website qua browser trong ứng dụng.
- **Chưa xây bot email production, chưa tích hợp vào API/UI/worker hiện có, chưa chạy toàn bộ 753 website, chưa có benchmark accuracy/recall hoàn chỉnh.**
- Dự án hiện dùng Node.js CommonJS, Express, Puppeteer, ExcelJS, Zod; Jest và ESLint có sẵn. Phiên này chưa audit sâu scraper hoặc kiến trúc server. Không được suy ra rằng scraper hiện tại đã có hoặc chưa có mọi tính năng email chỉ từ package.json.
- Không thay đổi package.json, không cài thêm dependency, không thay đổi code production. Script pilot và kết quả ban đầu nằm trong outputs; bộ docs này mang theo bản sao cần thiết.
- Không gửi email, không gửi form, không kiểm tra SMTP, không xác minh khả năng nhận thư của mailbox.

## Dữ liệu và cách chọn mẫu

File nguồn: data/Kings_dentist.xlsx. Sheet Leads: 1.147 bản ghi, 13 cột; 753 có website, 394 không; 686 URL chuỗi khác nhau; 554 hostname sau lowercase và bỏ www. Có 174 nhóm điện thoại không rỗng xuất hiện trên nhiều dòng.

Tên/địa chỉ/điện thoại cần được giữ để liên kết email đúng doanh nghiệp và chi nhánh. City có thể là nhãn công việc tìm kiếm, không phải địa lý chính xác của từng lead. center_lat/center_lng không được mặc định là tọa độ doanh nghiệp. Cùng phone/domain không đồng nghĩa bản ghi trùng: có thể là bác sĩ, phòng khám hoặc chi nhánh.

Mẫu: lấy dòng đầu tiên của mỗi hostname, chọn 8 bằng Python random.Random(20260910).sample; thêm hàng Excel 2 và 3. Mẫu khám phá, không đại diện đầy đủ cho lead hay website toàn thị trường. Đơn vị hàng trong báo cáo gồm hàng tiêu đề, không phải cột STT.

## Kết quả kiểm chứng cần giữ

| Hàng Excel | Doanh nghiệp | Kết quả |
|---|---|---|
| 495 | 5th Avenue Dentistry and Implants | frontdesk@5thavedentistry.com; visible text + mailto, địa chỉ/phone khớp |
| 113 | Midtown Dental Group Marine Park | marinepark@midtowndentalgroup.com; đúng chi nhánh 3605 Ave. S., 718-339-6544 |
| 3 | Beam Dental Union Square | unionsquare@mybeamdental.com; dữ liệu script và JSON-LD Dentist sau render khớp địa chỉ/phone; không thấy trong visible text/mailto |
| 194 | Flatlands Family Dental | Chưa thấy email; contact form |
| 491 | Krietchman Raymond | Chưa thấy email; website hướng dẫn liên hệ qua form |
| 282 | Dr. David S. Rogoff | Chưa thấy email; phone/fax |
| 20 | Brooklyn Dental PC | Chưa thấy email; call/text/fax |
| 2 | Integrated Aesthetic Dentistry | Chưa thấy email trong phạm vi, đã mở đúng Upper East Side |
| 708 | Kensington Dental Office | URL Weave hiển thị Williamsburg Smiles Family Dentistry; quan hệ chưa rõ, identity review |
| 806 | Dental Fillings Brooklyn | DNS resolution error trong môi trường thử |

2 email visible + 1 structured candidate không tương đương recall 30% hoặc precision 100%. Năm not_found không chứng minh toàn website không có email. Mẫu chưa có honeypot được xác nhận, email ảnh hoặc CSS đảo chữ; không được tuyên bố đã test thành công các cơ chế đó.

## Các phát hiện quan trọng hơn lý thuyết ban đầu

1. **Ẩn không đồng nghĩa honeypot.** Midtown có HTML data-cfemail và popup Email Us. Email không có trong body.innerText trước khi mở popup, nhưng mailto trong DOM sau decode và popup có email hợp lệ. Đã thao tác mở popup rồi xác nhận riêng trang Marine Park.
2. **Text sau render chưa đủ.** Beam công bố email trong dữ liệu của trang và JSON-LD tạo bằng JavaScript. Cần evidence_class riêng cho structured data; không yêu cầu mọi email hợp lệ phải visible.
3. **Website đầu vào có thể không khớp tên.** Weave trả tên khác lead; chưa xác minh được nguyên nhân. Không kết luận chắc URL sai hoặc doanh nghiệp đổi tên, nhưng không tự động gán kết quả.
4. **Discovery theo link đơn giản đi sai chi nhánh.** HTTP pilot đã đọc Fulton thay vì Upper East Side của IAD, và Edgewater thay vì Union Square của Beam. Cần ưu tiên branch target thay vì link order.
5. **Regex toàn HTML tạo false positive.** Đoạn /@40.730733 trong Google Maps URL bị bắt thành email. Regex còn lấy dấu nháy JavaScript trước email Beam. Cần parsing và validation theo nguồn.
6. **Placeholder là ứng viên sai.** Form iframe Midtown có john@doe.com trong placeholder. Trường E-mail của form không phải email doanh nghiệp.
7. **Phone không phải khóa tuyệt đối.** 5th Avenue có phone riêng cho bệnh nhân mới và cũ. IAD Upper East Side khớp địa chỉ nhưng số hiển thị khác Maps; ghi nhận khác biệt, không auto-reject.
8. **Lỗi browser phải tách khỏi not_found.** Chromium Puppeteer tại máy cũ không launch được (spawn Unknown system error -88). Đã dùng in-app browser thay thế để kiểm tra, không có timing browser script hợp lệ.

## Thông số pilot đã đo

HTTP ban đầu: 3 worker, homepage + tối đa 2 trang Contact/Location/About, timeout request 15 giây, cap body 2,5 MB. Wall-clock 20,046 giây gồm robots; 23 page attempts, 22 HTTP 200, 1 DNS error; 6.629.271 byte; median request thành công 1,665 giây, max 6,202 giây. Chưa gồm 2 HTTP supplemental và browser. Một lần chạy, không benchmark cold/warm cache hay công suất VPS.

Text/mailto parser ban đầu có kết quả trên 1 website. Decoder và dữ liệu script/schema thêm ứng viên ở Midtown/Beam. Không dùng kết quả này để tính recall vì chưa có gold set đầy đủ.

## Kiến trúc đã đề xuất, chưa phải cam kết đã triển khai

Input lead + website → nhận diện domain/tenant/chi nhánh → khám phá trang theo mục đích → HTTP extract nhiều kênh → candidate và bằng chứng → xác minh doanh nghiệp/vai trò → browser/interactions khi còn thiếu → OCR/AI khi có lý do → xếp hạng hoặc abstain.

- Kênh: text/DOM, mailto, JSON-LD, hydration data, data-cfemail/encoding đã biết, browser DOM và frame/open shadow roots, response công khai liên quan, CSS/pseudo-element, OCR và tài liệu được liên kết khi cần.
- Không eval mã website trong worker. Phục hồi encoding có provenance; không đoán info@domain hoặc tự sửa OCR mơ hồ. Không coi email trong bundle tự động là email doanh nghiệp.
- Closed shadow root không đọc được qua element.shadowRoot thông thường. Network idle và một fixed wait không đảm bảo readiness. Streaming/lazy hydration/islands có thể cần cuộn hoặc tương tác.
- Chọn hành động tiếp theo theo lợi ích dự kiến/chi phí, không ép mọi site qua tất cả tầng. Khi đã đủ bằng chứng dừng đúng lúc; audit một phần nhóm dừng sớm để đo bỏ sót.
- Xếp hạng theo đúng doanh nghiệp/chi nhánh, vai trò liên hệ, độ mới và bằng chứng. Cùng domain chỉ là tín hiệu; không loại Gmail được doanh nghiệp công bố. Email footer lặp trên 50 trang không phải 50 bằng chứng độc lập.
- Visibility là một tín hiệu, cần theo dõi trạng thái trước/sau thao tác; xử lý mâu thuẫn text và href riêng.
- DNS/syntax chỉ hỗ trợ, không chứng minh mailbox. Thiếu MX chưa đủ loại, Null MX là tín hiệu không nhận mail. Chưa có đề xuất tự gửi email thử trong scope đã thực hiện.
- Cache retrieval theo host/URL/tenant, attribution theo lead. Pool HTTP/browser riêng; per-domain concurrency, backoff, job lease/retry, time/page/byte limits, SSRF protection. Không để timeout/crash thành no_email.
- AI dùng chọn trang/hành động, phân loại và xử lý ca khó có evidence_id. Website là dữ liệu không đáng tin; AI không được nhận lệnh từ trang hay tự cấp quyền gửi form.
- Output tối thiểu: lead_id/row, original_url/final_url/source_url, email nguyên bản/chuẩn hóa, method, evidence, branch_match, role, visibility/state, observed_at, status, reason và phiên bản extractor. Confidence heuristic chưa hiệu chỉnh không được gọi là xác suất.

## Thứ tự triển khai tiếp theo được khuyến nghị

1. Đọc hướng dẫn repo và code hiện tại, xác định điểm tích hợp importer/job/worker/API; không viết lại toàn bộ Maps scraper theo giả định.
2. Khởi tạo schema candidate/evidence/result và các trạng thái found_visible, found_structured, not_found_within_budget, identity_review, fetch_error.
3. Dựng regression fixtures từ pilot: regex false positives, data-cfemail, structured script, branch attribution, placeholder, no-email within scope, booking mismatch và failure state.
4. Xây HTTP extractor + validation + khám phá đúng branch. Giữ nguyên URL chi nhánh từ Maps. Phân biệt chain, directory và tenant booking.
5. Thêm browser fallback, launch health check, readiness theo nội dung và thao tác Email Us/menu. Đo chi phí tăng thêm.
6. Lấy 100–150 hostname mới từ 554 làm tập gán nhãn tiếp theo; 10 website pilot chỉ là dev/regression set. Khi cần tuyên bố độ chính xác cao, mở rộng mẫu độc lập phù hợp khoảng tin cậy.
7. Chỉ ưu tiên OCR, giải mã hiếm hoặc AI đắt hơn khi phân tích lỗi cho thấy lợi ích thực tế.

Người dùng chưa chốt ngân sách RAM/CPU, throughput, chi phí, threshold production hoặc mục đích email chi tiết. Mặc định đã đề xuất là email liên hệ công khai đúng doanh nghiệp/chi nhánh; không khóa cứng nếu yêu cầu tiếp theo thay đổi. Mục tiêu precision ≥99% từng được nêu là mục tiêu thử nghiệm, không phải kết quả đạt được.

## Benchmark cần làm đúng

- Tách extraction, discovery, attribution/ranking và end-to-end để tìm đúng lớp bị lỗi.
- Gold labels có source và tương tác; không lấy output rỗng của bot làm nhãn âm. Nhãn không rõ giữ unknown.
- Tách train/dev/test theo doanh nghiệp/chuỗi/template khi phù hợp; có tập tương lai. Mẫu đại diện và stress fixtures báo riêng.
- So sánh HTTP đơn giản, parser+decoder/schema, discovery theo branch, browser toàn bộ, browser có điều kiện, OCR/AI. So sánh trong cùng ngân sách, không mặc định pipeline mới thắng.
- Report precision, recall trên tập có gold, branch/top-email accuracy, false positives ở mẫu âm/honeypot, coverage/review/error, p50/p95, correct-business-emails/minute và cost/correct-business-email.
- Giữ blocked/timeout trong báo cáo tổng; báo riêng nhóm truy cập được nếu cần. Cold/warm cache và browser health phải rõ. Lặp các run live khi cần đo độ ổn định, thống kê theo cụm domain thay vì coi email cùng site độc lập.
- Mỗi lỗi thực tế thành regression test; mỗi tầng mới đo cả email đúng tăng thêm và false positives mới.

## Nguồn nghiên cứu đã dùng

Các nguồn đã được đọc trong phiên; link chi tiết và cách áp dụng có trong transcript:

- [Next.js data fetching/streaming](https://nextjs.org/docs/app/getting-started/fetching-data)
- [Astro islands](https://v6.docs.astro.build/en/concepts/islands/)
- [Puppeteer page interactions](https://pptr.dev/guides/page-interactions)
- [MDN innerText](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/innerText)
- [MDN shadowRoot](https://developer.mozilla.org/en-US/docs/Web/API/Element/shadowRoot)
- [MDN getComputedStyle](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle)
- [Playwright network](https://playwright.dev/docs/network), [BrowserContext routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)
- [Cloudflare email obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/)
- [Cloudflare AI Labyrinth](https://developers.cloudflare.com/bots/additional-configurations/ai-labyrinth/)
- [Scrapy AutoThrottle](https://docs.scrapy.org/en/master/topics/autothrottle.html)
- [RFC 6068 mailto](https://www.rfc-editor.org/info/rfc6068/), [RFC 6531 SMTPUTF8](https://www.rfc-editor.org/info/rfc6531/)
- [RFC 5321 SMTP](https://www.rfc-editor.org/rfc/rfc5321.html), [RFC 7505 Null MX](https://www.rfc-editor.org/info/rfc7505/), [RFC 9309 robots](https://www.rfc-editor.org/rfc/rfc9309.html)
- [On Calibration of Modern Neural Networks](https://proceedings.mlr.press/v70/guo17a)

Tài liệu web có thể thay đổi sau ngày bàn giao; re-check API và phiên bản trước khi triển khai. Các raw HTML snapshot chỉ chứng minh nội dung tại thời điểm pilot, không chứng minh hành vi live tương lai.
