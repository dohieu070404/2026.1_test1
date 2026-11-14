# Kiểm tra bản React Native + Expo

Môi trường kiểm tra: Node 24.22.1; Expo 58.0.25; React Native 0.88.1; React 19.3.0.

| Kiểm tra | Kết quả |
| --- | --- |
| TypeScript (`tsc --noEmit`) | Đạt |
| ESLint (`expo lint`) | Đạt, không lỗi/cảnh báo mã nguồn |
| Jest | 18/18 đạt, 8 bộ kiểm thử |
| Expo Go/native-module guard | Đạt: không nạp custom BLE module hoặc hỏi quyền Bluetooth khi đang dùng Expo Go |
| SecureStore | Đạt ở unit test: key hash hợp lệ, tách backend, clear token đúng key |
| SQLite/outbox | Đạt với SQLite thật qua adapter Node: giữ raw/filtered, ID/body retry cố định, ACK, conflict, account/server isolation |
| UI renderer | Đạt: đăng nhập và chế độ mô phỏng riêng |
| Lifecycle | Đạt ở unit test: background kết thúc thu, dispose giải phóng timer, không để timer mô phỏng tồn sau cleanup |
| BLE reconnect/codec | Đạt ở unit test, chưa phải kết nối radio thật |
| `expo install --check` | Phiên bản khớp ma trận SDK cục bộ; chạy offline trong môi trường kiểm tra |
| Android Expo Prebuild | Đạt trong thư mục kiểm tra riêng; plugin BLE, SecureStore và build-properties sinh được cấu hình Android |
| Android production bundle | Đạt, Metro xuất Hermes bytecode khoảng 2,1 MB |
| Metro development server | Đạt: port 8082, `/status` chạy, phục vụ manifest Android và bundle development khoảng 5,3 MB, target Expo Go |

Bộ kiểm thử dùng mock cho Expo SecureStore/native context và adapter SQLite Node cho lớp lưu trữ; không coi kết quả đó là chứng nhận phần cứng.

Chưa thực hiện trong lần chuyển sang Expo này:

- Chạy trực tiếp Expo Go trên Android Emulator để xác minh toàn bộ giao diện/thao tác thực tế.
- Biên dịch APK development build mới với toàn bộ thư viện native Expo và kiểm thử radio hai ESP32 thật.
- Kiểm thử E2E với backend/MySQL đang triển khai.

Project vẫn giữ các giới hạn nghiệp vụ của mobile v4: chưa có calibration lực tuyệt đối, đồng bộ clock BLE hai chân, đo nền liên tục hoặc khởi tạo phiên BLE thật khi backend hoàn toàn offline. Chế độ mô phỏng chạy cục bộ và không được ghi nhận thành dữ liệu đo thật.

ZIP bàn giao chỉ chứa project mobile: không có backend, web, firmware, node_modules hoặc thư mục Android sinh tự động. Có lockfile để cài lại bằng npm ci.
