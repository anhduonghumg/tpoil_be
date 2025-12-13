// src/common/auth/permissions.constant.ts
export const PERMISSIONS = {
    system: {
        rbacAdmin: 'system.rbac.admin',
    },
    contracts: {
        view: 'contracts.view',
        create: 'contracts.create',
        update: 'contracts.update',
        delete: 'contracts.delete',
        import: 'contracts.import',
    },
    customers: {
        view: 'customers.view',
        create: 'customers.create',
        update: 'customers.update',
        delete: 'customers.delete',
    },
    employees: {
        view: 'employees.view',
        create: 'employees.create',
        update: 'employees.update',
        delete: 'employees.delete',
    },
} as const
