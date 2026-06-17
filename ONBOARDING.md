# Huong dan cho nguoi moi

Tai lieu nay giup dev moi nam nhanh cach chay, doc va lam viec voi backend TPOIL.

## Tong quan

Day la backend NestJS viet bang TypeScript. Du an dung Prisma cho database, Jest cho test, ESLint/Prettier cho chat luong code, va co 3 runtime chinh:

- `web`: API HTTP chinh.
- `worker`: xu ly tac vu nen.
- `scheduler`: chay lich va cron job.

## Yeu cau moi truong

- Node.js phu hop voi NestJS 11 va TypeScript 5.
- npm.
- PostgreSQL hoac database tuong ung voi `prisma/schema.prisma`.
- Redis neu can chay queue/background jobs.
- File `.env` lay tu nguoi quan ly du an. Khong commit `.env`.

## Cai dat lan dau

```bash
npm install
```

Sau khi co `.env`, tao Prisma client:

```bash
npx prisma generate
```

Neu can tao database local tu migration:

```bash
npx prisma migrate dev
```

Neu can seed du lieu mau:

```bash
npx prisma db seed
```

## Chay du an

Chay API web:

```bash
npm run start
```

Tuong duong:

```bash
npm run start:web
```

Chay worker:

```bash
npm run start:worker
```

Chay scheduler:

```bash
npm run start:scheduler
```

Chay ca 3 tien trinh:

```bash
npm run start:all
```

Build production:

```bash
npm run build
```

Chay ban da build:

```bash
npm run start:web:prod
npm run start:worker:prod
npm run start:scheduler:prod
```

## Lenh kiem tra chat luong

Kiem tra lint:

```bash
npm run lint
```

Tu dong sua mot so loi lint:

```bash
npm run lint:fix
```

Format code:

```bash
npm run format
```

Kiem tra format:

```bash
npm run format:check
```

Chay test:

```bash
npm run test
```

Chay e2e test:

```bash
npm run test:e2e
```

Chay coverage:

```bash
npm run test:cov
```

## Cau truc thu muc

```text
src/
  main.ts                    Entry point cho web app
  worker.ts                  Entry point cho worker
  scheduler.ts               Entry point cho scheduler
  app.module.ts              Module goc dung chung
  web-app.module.ts          Module cho web runtime
  worker-app.module.ts       Module cho worker runtime
  scheduler-app.module.ts    Module cho scheduler runtime
  audit/                     Ghi nhan audit log
  common/                    Filter, interceptor, util dung chung
  config/                    Config theo domain
  infra/                     Tich hop ha tang: logging, google drive, ...
  mail/                      Gui email
  modules/                   Cac module nghiep vu
  session/                   Xu ly session
  utils/                     Ham tien ich

prisma/
  schema.prisma              Schema database
  migrations/                Lich su migration
  seed.ts                    Seed data
```

## Cac module nghiep vu chinh

- `auth`, `rbac`, `users`: dang nhap, phan quyen, nguoi dung.
- `customers`, `employees`, `departments`: du lieu to chuc va khach hang.
- `products`, `supplier-locations`: danh muc san pham va nha cung cap.
- `contracts`, `contract-types`: hop dong.
- `purchases`: mua hang, purchase orders, purchase terms, receipts, supplier invoices.
- `inventory`: ton kho.
- `banking`, `bank-accounts`, `bank-purposes`, `bank-import-templates`: ngan hang va import giao dich.
- `price-bulletins`, `commodity-price-quotes`: bang gia va gia hang hoa.
- `settlements`: quyet toan.
- `background-jobs`, `cron`, `job-artifacts`: job nen, lich chay, artifact.
- `uploads`: upload va luu file.

## Quy uoc code

- Moi tinh nang nen nam trong module domain tuong ung duoi `src/modules`.
- Controller chi nhan request, validate input va goi service.
- Service chua nghiep vu va transaction database.
- DTO dat trong thu muc `dto`.
- Mapper/helper rieng neu logic mapping lon hoac lap lai.
- Dung Prisma service/repository pattern hien co trong module gan nhat.
- Khong commit file sinh ra nhu `dist`, `coverage`, `uploads`, `storage`.

## Format va lint

Prettier la nguon chuan cho style code:

- 2 spaces.
- Co dau cham phay.
- Single quote.
- Trailing comma.
- `printWidth` 100.

ESLint dang dung flat config tai `eslint.config.mjs`. Hien tai mot so rule type-safety duoc de o muc `warn` de khong chan codebase cu. Khi sua file nao, nen xu ly warning trong file do neu co the.

## Lam viec voi Prisma

Khi thay doi database:

1. Sua `prisma/schema.prisma`.
2. Tao migration:

```bash
npx prisma migrate dev --name ten_migration
```

3. Generate client:

```bash
npx prisma generate
```

4. Kiem tra code lien quan va chay test/lint.

Khong sua migration da ap dung tren moi truong chung neu khong co thong nhat voi team.

## Workflow khi lam feature

1. Xac dinh module domain can sua.
2. Doc controller, service, dto va schema lien quan.
3. Them/sua DTO neu API nhan input moi.
4. Them logic trong service, uu tien transaction khi co nhieu thao tac database lien quan nhau.
5. Cap nhat Prisma schema/migration neu thay doi model.
6. Chay:

```bash
npm run lint
npm run test
```

7. Format code truoc khi commit:

```bash
npm run format
```

## Checklist truoc khi mo pull request

- Code da format.
- `npm run lint` khong co error.
- Test lien quan da chay.
- Khong commit `.env`, file upload, file build, log, hoac data local.
- Migration co ten ro nghia neu co thay doi database.
- API moi co DTO va validation phu hop.
- Khong de logic nghiep vu lon trong controller.

## Noi nen bat dau khi debug

- Loi API: xem controller va service trong module tuong ung.
- Loi database: xem `prisma/schema.prisma`, migration gan nhat va query trong service.
- Loi auth/session: xem `src/modules/auth`, `src/session`, va config session trong entry point.
- Loi queue/job: xem `src/modules/background-jobs`, `src/modules/cron`, `src/worker.ts`, `src/scheduler.ts`.
- Loi upload/file: xem `src/modules/uploads`, `storage`, `uploads`.
- Loi logging/audit: xem `src/infra/logging` va `src/audit`.

## Luu y bao mat

- Khong log token, password, cookie, private key, connection string.
- Khong commit `.env` hoac credential Google Drive/mail/database.
- Khi them endpoint moi, kiem tra guard, permission va audit neu endpoint thay doi du lieu quan trong.
