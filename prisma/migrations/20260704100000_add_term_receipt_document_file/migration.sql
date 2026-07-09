ALTER TABLE "GoodsReceipt"
ADD COLUMN "receiptDocumentTemplate" TEXT,
ADD COLUMN "sourceFileName" TEXT,
ADD COLUMN "sourceFileUrl" TEXT,
ADD COLUMN "sourceFileMimeType" TEXT,
ADD COLUMN "sourceFileSizeBytes" INTEGER,
ADD COLUMN "sourceFileChecksum" TEXT,
ADD COLUMN "note" TEXT;
