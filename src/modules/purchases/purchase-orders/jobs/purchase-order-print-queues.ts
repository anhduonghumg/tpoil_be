import { BackgroundJobType } from '@prisma/client'
export const QB_PURCHASE_ORDER_PRINT = 'purchase-order-print'
export const PURCHASE_ORDER_PRINT_JOB_TYPE = BackgroundJobType.PURCHASE_ORDER_PRINT_BATCH
export const PURCHASE_ORDER_PRINT_JOB_NAME = 'Print purchase orders'
export const ARTIFACT_PO_PRINT_INPUT = 'po_print_input'
export const ARTIFACT_PO_PRINT_OUTPUT = 'po_print_output'
