/**
 * Thông tin pháp nhân in trên thông báo giá và quyết định điều chỉnh giá.
 *
 * Để một chỗ duy nhất vì hai mẫu phải khớp nhau từng chữ — đổi địa chỉ mà sửa hai nơi là
 * kiểu gì cũng lệch. Chưa đưa vào DB vì cả hệ thống mới có đúng một pháp nhân phát hành
 * giá; khi nào có pháp nhân thứ hai thì chuyển sang bảng cấu hình, chữ ký gọi vẫn vậy.
 */
export const PRICE_DOC_COMPANY = {
    name: 'CÔNG TY TNHH VẬN TẢI & TM XĂNG DẦU THIÊN PHÚC',
    /** Tên rút gọn dùng trong câu văn của quyết định, cho khỏi dài dòng. */
    shortName: 'Công ty TNHH Vận tải & TM xăng dầu Thiên Phúc',
    address: '09, Triệu Quốc Đạt, P. Hạc Thành, T. Thanh Hóa',
    phone: '0948 221 999',
    hotline: '0985.054.560',
    contact: 'Mrs.Mai: 0919.011.958',
    taxCode: '2802198911',
    website: 'https://www.tpoil.net',
    /** Nơi ký, in ở góc phải phần mở đầu quyết định. */
    place: 'Thanh Hóa',
} as const

/** Người ký quyết định. Chừa chỗ trống bên dưới để đóng dấu và ký tay. */
export const PRICE_DOC_SIGNER = {
    onBehalfOf: 'TUQ. GIÁM ĐỐC',
    title: 'PHÓ GIÁM ĐỐC',
    name: 'Nguyễn Ngọc Mai',
} as const

/** Khối "Nơi nhận" ở chân quyết định. */
export const PRICE_DOC_RECIPIENTS = [
    'Bộ Công thương (Cục QL & PT TTTN);',
    'Bộ tài chính (Cục quản lý giá);',
    'Sở CT Thanh Hóa, Sở CT Hưng Yên, Sở CT Nghệ An,…',
    'CH bán lẻ, các đại lý;',
    'Lưu KD.',
] as const

/** Các căn cứ pháp lý cố định; căn cứ công văn của kỳ điều chỉnh được thêm vào lúc dựng. */
export const PRICE_DOC_LEGAL_BASES = [
    'Căn cứ Luật Doanh nghiệp số: 59/2020/QH14 ngày 17/6/2020 của Quốc hội Nước cộng hòa xã hội chủ nghĩa Việt Nam;',
    'Căn cứ Nghị định số: 83/2014/NĐ-CP ngày 03 tháng 09 năm 2014 của Chính phủ về kinh doanh xăng dầu;',
    'Căn cứ Nghị định số: 95/2021/NĐ-CP ngày 01 tháng 11 năm 2021 của Chính phủ sửa đổi, bổ sung một số điều của Nghị định số: 83/2014/NĐ-CP ngày 03 tháng 09 năm 2014 về kinh doanh xăng dầu;',
    `Căn cứ Điều lệ của ${'Công ty TNHH Vận tải & TM xăng dầu Thiên Phúc'};`,
] as const
