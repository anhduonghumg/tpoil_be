import { Prisma } from '@prisma/client'

/**
 * Điều kiện lọc "hợp đồng cho phép giao dịch mua bán xăng dầu".
 *
 * Dựa vào cờ ContractType.allowsTrading — là DỮ LIỆU do người dùng bật/tắt ở màn quản lý
 * loại hợp đồng, không phải danh sách mã cứng trong code. Thêm một loại mới (vd "hợp đồng
 * mua bán trực tiếp") chỉ cần tick ô, không phải sửa và deploy lại backend.
 *
 * CHIỀU giao dịch không nằm ở hợp đồng: nó do loại thương nhân của đối tác quyết định
 * (TNPP mua và bán, TNDM chỉ mua của họ, TNDL chỉ bán cho họ) và được
 * PartyMerchantService.assertCanTrade() thực thi theo đúng ngày chứng từ. Hợp đồng chỉ
 * trả lời "có thỏa thuận hợp lệ để giao dịch mặt hàng này không".
 */
export const TRADING_CONTRACT_TYPE_WHERE: Prisma.ContractTypeWhereInput = {
    allowsTrading: true,
    deletedAt: null,
}

/** Dùng trong `where` của Contract: `{ contractType: TRADING_CONTRACT_TYPE_WHERE }`. */
export const tradingContractWhere = (): Prisma.ContractWhereInput => ({
    contractType: TRADING_CONTRACT_TYPE_WHERE,
})
