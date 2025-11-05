export const MODULE_CODES = {
    DEPARTMENT: 'Phòng ban',
    EMPLOYEE: 'Nhân sự',
    USER: 'Người dùng',
    FINANCE: 'Tài chính',
    INVENTORY: 'Kho',
    CUSTOMER: 'Khách hàng',
    CONTRACT: 'Hợp đồng',
} as const

export type ModuleCode = (typeof MODULE_CODES)[keyof typeof MODULE_CODES]
