/**
 * Vá một lần các lô sinh từ phiếu rút thương mại từng bị gán chủ hàng là NCC
 * thay vì pháp nhân của kho.
 *
 * Sổ kho là append-only, vì vậy script không sửa bút toán cũ. Với phần tồn còn
 * lại, script tạo chứng từ chuyển chủ NCC -> TP rồi mới sửa metadata nguồn bị sai.
 * Mặc định chỉ kiểm tra; truyền --apply mới ghi dữ liệu.
 */
import { InventoryDocumentStatus, InventoryPostingKind, PrismaClient } from '@prisma/client'
import { InventoryCoreService } from '../src/modules/inventory/inventory-core.service'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient()
const inventoryCore = new InventoryCoreService()

async function main() {
    const receipts = await prisma.goodsReceipt.findMany({
        where: { note: { startsWith: 'Rút lô' } },
        include: {
            warehouse: {
                select: { name: true, legalEntity: { select: { code: true, partyId: true } } },
            },
            lines: {
                include: {
                    product: { select: { code: true } },
                    lot: {
                        select: {
                            id: true,
                            lotNo: true,
                            stockBalances: {
                                select: {
                                    warehouseId: true,
                                    productId: true,
                                    ownerPartyId: true,
                                    actualQty: true,
                                    v15Qty: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    })

    const wrongLines = receipts.flatMap((receipt) => {
        const correctOwnerPartyId = receipt.warehouse.legalEntity.partyId
        return receipt.lines
            .filter((line) => line.lot && line.ownerPartyId !== correctOwnerPartyId)
            .map((line) => ({ receipt, line, correctOwnerPartyId }))
    })

    if (!wrongLines.length) {
        console.log('Không có lô kho nào sai chủ hàng.')
        return
    }

    for (const { receipt, line, correctOwnerPartyId } of wrongLines) {
        const lot = line.lot!
        const stock = lot.stockBalances.find(
            (balance) =>
                balance.warehouseId === receipt.warehouseId &&
                balance.productId === line.productId &&
                balance.ownerPartyId === line.ownerPartyId,
        )
        console.log(
            `${receipt.receiptNo}  ${line.product.code}  lô ${lot.lotNo}` +
                `  chủ hàng -> ${receipt.warehouse.legalEntity.code}` +
                `  tồn chuyển=${stock?.actualQty.toString() ?? '0'}`,
        )
        if (!apply) continue

        await prisma.$transaction(async (tx) => {
            if (stock?.actualQty.greaterThan(0)) {
                const transferNo = `FIX-LOT-OWNER-${lot.id}`
                const transfer = await tx.ownershipTransfer.create({
                    data: {
                        transferNo,
                        warehouseId: receipt.warehouseId,
                        fromOwnerPartyId: line.ownerPartyId,
                        toOwnerPartyId: correctOwnerPartyId,
                        status: InventoryDocumentStatus.POSTED,
                        effectiveAt: new Date(),
                        lines: {
                            create: {
                                lineNo: 1,
                                productId: line.productId,
                                inventoryLotId: lot.id,
                                actualQty: stock.actualQty,
                                v15Qty: stock.v15Qty,
                            },
                        },
                    },
                })
                await inventoryCore.post(tx, {
                    postingNo: `POST-${transferNo}`,
                    kind: InventoryPostingKind.OWNERSHIP_TRANSFER,
                    idempotencyKey: `repair:commercial-lot-owner:${lot.id}`,
                    effectiveAt: transfer.effectiveAt,
                    source: { ownershipTransferId: transfer.id },
                    lines: [
                        {
                            warehouseId: receipt.warehouseId,
                            productId: line.productId,
                            ownerPartyId: line.ownerPartyId,
                            inventoryLotId: lot.id,
                            actualQtyDelta: stock.actualQty.negated(),
                            v15QtyDelta: stock.v15Qty?.negated() ?? null,
                        },
                        {
                            warehouseId: receipt.warehouseId,
                            productId: line.productId,
                            ownerPartyId: correctOwnerPartyId,
                            inventoryLotId: lot.id,
                            actualQtyDelta: stock.actualQty,
                            v15QtyDelta: stock.v15Qty,
                        },
                    ],
                })
            }

            await tx.goodsReceiptLine.update({
                where: { id: line.id },
                data: { ownerPartyId: correctOwnerPartyId },
            })
            await tx.inventoryLot.update({
                where: { id: lot.id },
                data: { originOwnerPartyId: correctOwnerPartyId },
            })
        })
        console.log('   -> đã sửa lô kho bằng bút toán chuyển chủ')
    }

    if (!apply) console.log('\nChạy lại kèm --apply để thực sự sửa.')
}

main()
    .catch((error) => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(() => void prisma.$disconnect())
