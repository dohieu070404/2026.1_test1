# SmartInsole Mobile — React Native + Expo

Đây là project **riêng phần mobile**, dùng React Native, TypeScript và Expo SDK 58. Không cần đặt trong thư mục web/server. Giao diện được dựng bằng các component React Native và SVG.

## 1. Chạy nhanh trên máy ảo Android bằng Expo Go

Chuẩn bị:

- Node.js **24.3 trở lên trong nhánh 24**, hoặc **22.13 trở lên trong nhánh 22**.
- Android Studio, Android SDK Platform Tools và một máy ảo Android đang bật. Có thể dùng Pixel/API 35.
- Máy tính có Internet để cài các gói npm và Expo Go phù hợp SDK 58.

Giải nén rồi mở Terminal/CMD trong thư mục `smart-insole-mobile-expo`:

```sh
npm ci
npm run android
```

`npm run android` chạy `expo start --go --android --port 8082`, mở project bằng Expo Go trên máy ảo. Nếu muốn tự mở bằng phím **a**:

```sh
npm start
```

Cổng Metro của Expo là **8082**; backend SmartInsole hiện tại vẫn dùng **8081**, nên hai dịch vụ không tranh cùng cổng.

Tại màn hình đầu, chọn **Thử mô phỏng không cần tài khoản**. App mở riêng màn hình theo dõi với hai chân, tám kênh mỗi bên và đồ thị. Chưa cần backend hoặc ESP32. Nhãn **DỮ LIỆU MÔ PHỎNG** luôn xuất hiện, dữ liệu này không được gửi lên API như một phiên thật. Chọn **Kết thúc đo** hoặc **Về đăng nhập** để thoát.

Nếu Expo Go đang cài không hỗ trợ SDK 58, để Expo CLI cài/cập nhật đúng bản cho Android, hoặc tải từ https://expo.dev/go. Không hạ riêng `react-native` hoặc `expo` xuống một phiên bản khác mà giữ nguyên các thư viện còn lại.

## 2. Dùng với backend đang có

Backend không nằm trong ZIP này. App sử dụng API của bản SmartInsole v4 đã bàn giao trước đó.

Trên Android Emulator, giá trị mặc định là:

```text
http://10.0.2.2:8081/api/v1
```

`10.0.2.2` trỏ về máy tính chạy Android Emulator. Nếu chạy Node trực tiếp ở cổng khác, sửa lại đúng cổng. `localhost` bên trong máy ảo không trỏ tới backend trên máy tính.

Có hai cách cấu hình:

- Sửa ô **Địa chỉ Backend API** tại màn hình đăng nhập.
- Hoặc copy `.env.example` thành `.env`, sửa `EXPO_PUBLIC_API_URL`, sau đó khởi động lại Expo.

Ví dụ Windows CMD:

```bat
copy .env.example .env
npm start -- --clear
```

Sau khi backend hoạt động, có thể đăng ký/đăng nhập, xem dashboard, claim cặp lót, đổi tên, xem phiên/lịch sử/kết quả và cập nhật hồ sơ. Các chức năng này dùng dữ liệu thật từ API. Phiên Wi-Fi đọc dữ liệu do ESP32 gửi trực tiếp lên backend; Expo Go không giả lập một kết nối BLE thật.

Token đăng nhập nằm trong `expo-secure-store`. Hàng đợi dữ liệu nằm trong `expo-sqlite`, tách theo tài khoản và URL server. Không đưa token, mật khẩu hoặc Device credential vào biến `EXPO_PUBLIC_*` vì các biến đó có thể được đọc từ bundle ứng dụng.

## 3. BLE với ESP32: dùng Expo development build

Expo Go không có native module `react-native-ble-plx`. Bản này vẫn mở được trong Expo Go vì module BLE chỉ được nạp khi thực sự dùng hardware trong development build. Nút quét BLE ở Expo Go có thông báo hướng dẫn, không báo kết nối giả.

Để kết nối hai ESP32 thật, cần Android Studio/toolchain trên máy và chạy:

```sh
npm ci
npm run android:dev
```

Lệnh này tương đương `expo run:android --port 8082`: Expo tạo dự án Android native, cài development build và mở Metro. Những lần sau đã có bản development build trên máy:

```sh
npm run start:dev
```

Đối với thử phần cứng thật, chạy development build trên điện thoại Android có Bluetooth. Có thể chọn thiết bị qua `npm run android:dev -- --device`.

Cần dùng firmware **BLE v3** và backend có các endpoint mobile của bản v4. Firmware Wi-Fi cũ chưa có BLE thì không thể xuất hiện như một lót BLE thật. Device credential chỉ được provision trên ESP32; app sử dụng claim và vé cấp quyền từ backend, không giữ credential đó.

Flow thật: đăng nhập → nhận quyền sở hữu cặp → kết nối đúng LEFT/RIGHT → tạo phiên → nhận raw/filtered → lưu SQLite trước ACK → đồng bộ API → dừng/drain → lịch sử. Fresh start và cấp lại vé cần backend trực tuyến; sau khi phiên bắt đầu, dữ liệu đã nhận được đệm nếu Internet mất.

Bản này kết thúc thu khi chuyển nền/khóa màn hình, không cam kết đo nền liên tục. Trạng thái phiên gián đoạn và lô chưa gửi được giữ lại để khôi phục/đồng bộ. Không quy đổi ADC thành kg/N/kPa khi chưa hiệu chuẩn.

`eas.json` có profile development nếu sau này bạn muốn build bằng dịch vụ Expo. Chạy Expo Go hoặc build local không bắt buộc dùng dịch vụ cloud này.

## 4. Cấu trúc code

| Đường dẫn | Chức năng |
| --- | --- |
| `App.tsx` | Khởi động, tài khoản, dashboard và điều hướng |
| `src/screens` | Thiết bị, theo dõi, lịch sử/kết quả |
| `src/api/client.ts` | API, timeout, token SecureStore |
| `src/storage` | SQLite, capture, outbox, job upload cố định |
| `src/transport/ble.ts` | Scan/connect/reconnect, codec và ACK BLE |
| `src/runtime/environment.ts` | Nhận biết Expo Go/development build |
| `src/domain` | Kiểu dữ liệu, giao thức và đồng bộ |
| `src/state/engine.ts` | Điều phối phiên, mô phỏng và lifecycle |
| `src/ui` | Component native, biểu đồ, sơ đồ chân, StyleSheet riêng |
| `test` | Kiểm thử dữ liệu, lưu/sync, Expo Go và UI renderer |

Không cần chép thư mục Android cũ vào project. Expo tự sinh phần native khi chạy `android:dev`; mặc định `npm start` vẫn dùng Expo Go.

## 5. Kiểm tra và xử lý lỗi

```sh
npm run check
npm run export:android
```

Kết quả kiểm tra được ghi tại `VERIFICATION.md`. Export Android kiểm tra Metro/Hermes bundle; thư mục export không phải APK và không thay cho việc thử phần cứng.

| Hiện tượng | Cách kiểm tra |
| --- | --- |
| Không mở được máy ảo | Bật AVD trong Android Studio trước; kiểm tra `adb devices` và đường dẫn Android SDK |
| Không tìm thấy `adb` | Thêm Android SDK `platform-tools` vào PATH hoặc đặt ANDROID_HOME |
| Expo mở nhầm development client | Dùng `npm start` hoặc `npx expo start --go --port 8082` |
| Bundle/cache cũ | Dừng Metro rồi chạy `npm start -- --clear` |
| API không kết nối | Kiểm tra backend đang chạy; trên Emulator dùng `10.0.2.2`, đúng cổng và `/api/v1` |
| Expo Go báo thiếu module/không khớp SDK | Cài Expo Go hỗ trợ SDK 58, chạy `npm ci`; các thư viện SDK đã được khóa trong lockfile |
| Không quét được ESP32 ở Expo Go | Chuyển sang `npm run android:dev`; không dùng dữ liệu mô phỏng để thay cho kết nối thật |

Tài liệu chính thức:

- https://docs.expo.dev/get-started/start-developing/
- https://docs.expo.dev/develop/development-builds/introduction/
- https://docs.expo.dev/versions/latest/sdk/sqlite/
- https://docs.expo.dev/versions/latest/sdk/securestore/
