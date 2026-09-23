/**
 * Cố định múi giờ Việt Nam cho toàn bộ tiến trình backend.
 *
 * Nghiệp vụ chạy trên ngày lịch Việt Nam: chốt công nợ cuối tháng, ngày đặt hàng, hạn thanh
 * toán, nhắc hợp đồng hết hạn. Code khắp nơi dựng "đầu ngày / cuối ngày" bằng giờ địa phương
 * của tiến trình (setHours(0,0,0,0), new Date(y, m, d), `${ngày}T00:00:00`), nên kết quả phụ
 * thuộc máy đang chạy: máy dev đặt múi +7 thì đúng, còn server chạy UTC thì ranh giới ngày
 * lệch 7 tiếng — giao dịch từ 0 đến 7 giờ sáng rơi sang ngày hôm trước.
 *
 * Phải là import ĐẦU TIÊN của mỗi điểm vào (main.ts, worker.ts, scheduler.ts): import được
 * nâng lên trước mọi dòng code, nên đặt ở đây mới chắc chắn chạy trước khi có Date nào được
 * tạo. Asia/Ho_Chi_Minh không có giờ mùa hè, luôn là UTC+7.
 */
export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh'

process.env.TZ = VN_TIME_ZONE
