// src/config/banking.config.ts
export const BANK_IMPORT_MODE = (process.env.BANK_IMPORT_MODE ?? 'sync') as 'sync' | 'queue'
export const BANK_IMPORT_SYNC_MAX_ROWS = Number(process.env.BANK_IMPORT_SYNC_MAX_ROWS ?? 500)
