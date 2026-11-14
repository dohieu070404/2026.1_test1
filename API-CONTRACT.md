# API mobile sử dụng

Cấu hình URL đến `/api/v1`. Dùng backend SmartInsole v4 hiện có; ZIP này không chứa server, database hay firmware.

| Nhóm | Endpoint |
| --- | --- |
| Tài khoản | POST /auth/register, /auth/login, /auth/refresh, /auth/logout; GET/PATCH /me |
| Tổng quan/cặp lót | GET /overview, /pairs; PATCH /pairs/:uid; POST /pairs/claim |
| Phiên | POST /sessions; GET /sessions, /sessions/:id; POST /sessions/:id/start, /stop, /process |
| Dữ liệu | GET /streams/:id/plot, /frames; GET /sessions/:id/quality, /metrics, /events |
| BLE gateway | POST /mobile/devices/:uid/authorize, /verify |
| Stream gateway | POST /mobile/devices/:uid/sessions/:id/streams |
| Batch/đóng | POST /mobile/devices/:uid/streams/:id/batches, /close |

Giao thức BLE giữ v3 của bản v4: service `327e0001-4f41-4e53-4f4c-453300000001`, identity/control/data lần lượt 0002/0003/0004; packet little endian, 1–3 frame, mỗi frame 77 byte. Dữ liệu gắn session/stream, UID, bên và boot UUID. ADC raw và filtered là hai mảng riêng, mỗi mảng tám giá trị.

SQLite COMMIT trước ACK BLE. Upload job giữ nguyên ID/body khi retry; chỉ đánh dấu đồng bộ sau ACK backend committed=true, đúng ID và số frame. Lỗi 409 bị giữ để kiểm tra, không tự thay batch ID để né conflict. Chế độ mô phỏng không tạo phiên thật và không gọi ingest.

Khung thời gian BLE vẫn là monotonic theo boot; chưa bổ sung đồng bộ clock_models hay hiệu chuẩn lực vào bản Expo này. Đó là phần việc ngoài phạm vi chuyển mobile sang Expo.
