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
    users: {
        view: 'users.view',
        create: 'users.create',
        update: 'users.update',
        delete: 'users.delete',
        assignRoles: 'users.assign_roles',
        assignEmployee: 'users.assign_employee',
        resetPassword: 'users.reset_password',
    },
} as const
