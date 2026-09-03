WITH system_module AS (
    INSERT INTO "Module" ("id", "code", "name", "createdAt", "updatedAt")
    VALUES (uuid_generate_v7(), 'system', 'Hệ thống', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id"
), permission_codes("code", "name") AS (
    VALUES
        ('system.opening_balances.view', 'Xem số dư đầu kỳ'),
        ('system.opening_balances.manage', 'Nhập và kiểm tra số dư đầu kỳ'),
        ('system.opening_balances.post', 'Ghi sổ và đảo số dư đầu kỳ')
)
INSERT INTO "Permission" ("id", "code", "name", "moduleId", "createdAt", "updatedAt")
SELECT uuid_generate_v7(), permission_codes."code", permission_codes."name", system_module."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM permission_codes CROSS JOIN system_module
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name", "moduleId" = EXCLUDED."moduleId", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
CROSS JOIN "Permission" permission
WHERE role."code" = 'system-admin'
  AND permission."code" IN (
      'system.opening_balances.view',
      'system.opening_balances.manage',
      'system.opening_balances.post'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
