export type PreviewConflict = {
    type: 'REGION_NOT_MAPPED' | 'EXIST_SAME_DATE' | 'OLDER_THAN_CURRENT'
    message: string
}

export type PreviewLine = {
    lineNo: number
    productNameRaw: string
    regionId: string
    price: number
    effectiveFrom: string
    conflict?: PreviewConflict
}
