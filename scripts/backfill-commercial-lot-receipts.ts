/**
 * Vá dữ liệu cũ: các phiếu rút lô thương mại đã CONFIRMED trước khi rút lô được ghi
 * thẳng vào sổ kho. Chúng chỉ tạo GoodsReceipt để theo dõi nên không có lô kho, không
 * có tồn — bán hàng không thấy tồn và không chọn được mã NCC khi duyệt đơn.
 *
 * Script chạy lại đúng bước ghi sổ cho từng phiếu còn thiếu. Idempotent: phiếu nào đã
 * có lô kho thì bỏ qua.
 *
 *   npx ts-node -r dotenv/config scripts/backfill-commercial-lot-receipts.ts
 *   npx ts-node -r dotenv/config scripts/backfill-commercial-lot-receipts.ts --apply
 *
 * Không có --apply thì chỉ liệt kê việc sẽ làm, không ghi gì.
 */
import { PrismaClient } from '@prisma/client'
import { InventoryCoreService } from '../src/modules/inventory/inventory-core.service'
import { GoodsReceiptPostingService } from '../src/modules/inventory/goods-receipt-posting.service'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient()
const posting = new GoodsReceiptPostingService(new InventoryCoreService())

async function main() {
    const lines = await prisma.commercialLotWithdrawalLine.findMany({
        where: {
            withdrawal: { status: 'CONFIRMED' },
            goodsReceiptId: { not: null },
            goodsReceipt: { lines: { none: { lot: { isNot: null } } } },
        },
        include: {
            goodsReceipt: {
                select: {
                    id: true,
                    receiptNo: true,
                    warehouseId: true,
                    warehouse: { select: { legalEntity: { select: { partyId: true } } } },
                    lines: { select: { id: true, ownerPartyId: true } },
                },
            },
            destinationWarehouse: { select: { id: true, name: true } },
            withdrawal: {
                select: {
                    withdrawalNo: true,
                    withdrawalDate: true,
                    destinationWarehouseId: true,
                    purchaseOrder: { select: { orderNo: true, releaseCode: true } },
                },
            },
            commercialLotPosition: {
                select: {
                    productId: true,
                    purchaseOrderLineId: true,
                    supplierCustomerId: true,
                    releaseCode: true,
                    product: { select: { code: true } },
                    supplier: { select: { code: true } },
                },
            },
        },
    })

    if (!lines.length) {
        console.log('Không có phiếu rút lô nào cần vá.')
        return
    }

    console.log(`${lines.length} phiếu rút lô chưa ghi sổ kho:`)
    for (const line of lines) {
        const position = line.commercialLotPosition
        const warehouseId =
            line.destinationWarehouseId ??
            line.withdrawal.destinationWarehouseId ??
            line.goodsReceipt!.warehouseId
        const releaseCode = position.releaseCode ?? line.withdrawal.purchaseOrder.releaseCode
        console.log(
            `  ${line.goodsReceipt!.receiptNo}  ${position.product.code}  ${line.actualQty.toString()}` +
                `  NCC=${position.supplier?.code ?? '?'}  mã rút=${releaseCode ?? '?'}`,
        )
        if (!apply) continue
        if (!warehouseId) {
            console.log('    -> BỎ QUA: không xác định được kho đích.')
            continue
        }
        await prisma.$transaction(async (tx) => {
            // Luồng cũ ghi chủ hàng của dòng phiếu nhập là NCC. postSingleLineReceipt
            // upsert dòng này với `update: {}` nên sẽ giữ nguyên chủ hàng sai và bán
            // hàng vẫn không thấy tồn — phải trả về pháp nhân của kho trước khi post.
            const ownerPartyId = line.goodsReceipt!.warehouse.legalEntity.partyId
            for (const receiptLine of line.goodsReceipt!.lines) {
                if (receiptLine.ownerPartyId === ownerPartyId) continue
                await tx.goodsReceiptLine.update({
                    where: { id: receiptLine.id },
                    data: { ownerPartyId },
                })
            }
            await posting.postSingleLineReceipt({
                ownerPartyId,
                tx,
                goodsReceiptId: line.goodsReceipt!.id,
                warehouseId,
                productId: position.productId,
                purchaseOrderLineId: position.purchaseOrderLineId,
                actualQty: line.actualQty,
                v15Qty: line.v15Qty,
                temperatureC: line.temperatureC,
                density: line.density,
                effectiveAt: line.withdrawal.withdrawalDate,
                supplierPartyId: position.supplierCustomerId,
                releaseCode,
                awaitingSupplierInvoice: false,
            })
        })
        console.log('    -> đã ghi sổ kho.')
    }

    if (!apply) console.log('\nChạy lại kèm --apply để thực sự ghi sổ.')
}

main()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(() => void prisma.$disconnect())
