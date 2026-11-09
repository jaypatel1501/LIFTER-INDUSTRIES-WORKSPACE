-- CreateEnum
CREATE TYPE "GSTRegistrationType" AS ENUM ('REGULAR', 'COMPOSITION', 'SEZ', 'ISD', 'TDS', 'TCS', 'UNREGISTERED');

-- CreateEnum
CREATE TYPE "GSTAdapterMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "GSTAdjustmentType" AS ENUM ('CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "GSTAdjustmentSide" AS ENUM ('SALES', 'PURCHASE');

-- CreateEnum
CREATE TYPE "GSTReconciliationStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GSTReconciliationLineStatus" AS ENUM ('MATCHED', 'MISMATCH', 'MISSING_IN_BOOKS');

-- CreateEnum
CREATE TYPE "GSTPeriodAction" AS ENUM ('LOCK', 'UNLOCK');

-- AlterTable
ALTER TABLE "SalesDocument" ADD COLUMN "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "SalesDocumentLine"
    ADD COLUMN "cessRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    ADD COLUMN "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN "isTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "reverseCharge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseDocument" ADD COLUMN "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseDocumentLine"
    ADD COLUMN "cessRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    ADD COLUMN "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN "isTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "reverseCharge" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GSTRegistration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "stateCode" TEXT NOT NULL,
    "registrationType" "GSTRegistrationType" NOT NULL DEFAULT 'REGULAR',
    "effectiveFrom" DATE NOT NULL,
    "filingFrequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "adapterMode" "GSTAdapterMode" NOT NULL DEFAULT 'SANDBOX',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GSTRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GSTPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "lockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GSTPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GSTPeriodEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "GSTPeriodAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GSTPeriodEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GSTReconciliationUpload" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "status" "GSTReconciliationStatus" NOT NULL DEFAULT 'PROCESSING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GSTReconciliationUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GSTReconciliationLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "supplierGstin" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "utgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "GSTReconciliationLineStatus" NOT NULL,
    "bookDocumentId" TEXT,
    "mismatchDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GSTReconciliationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GSTAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "adjustmentType" "GSTAdjustmentType" NOT NULL,
    "side" "GSTAdjustmentSide" NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "noteDate" DATE NOT NULL,
    "counterpartyGstin" TEXT,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "utgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GSTAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GSTRegistration_companyId_key" ON "GSTRegistration"("companyId");
CREATE UNIQUE INDEX "GSTRegistration_gstin_key" ON "GSTRegistration"("gstin");
CREATE INDEX "GSTRegistration_stateCode_isActive_idx" ON "GSTRegistration"("stateCode", "isActive");

CREATE UNIQUE INDEX "GSTPeriod_companyId_id_key" ON "GSTPeriod"("companyId", "id");
CREATE UNIQUE INDEX "GSTPeriod_companyId_periodKey_key" ON "GSTPeriod"("companyId", "periodKey");
CREATE INDEX "GSTPeriod_companyId_isLocked_periodKey_idx" ON "GSTPeriod"("companyId", "isLocked", "periodKey");

CREATE UNIQUE INDEX "GSTPeriodEvent_companyId_idempotencyKey_key" ON "GSTPeriodEvent"("companyId", "idempotencyKey");
CREATE INDEX "GSTPeriodEvent_companyId_periodId_createdAt_idx" ON "GSTPeriodEvent"("companyId", "periodId", "createdAt");

CREATE UNIQUE INDEX "GSTReconciliationUpload_companyId_id_key" ON "GSTReconciliationUpload"("companyId", "id");
CREATE UNIQUE INDEX "GSTReconciliationUpload_companyId_idempotencyKey_key" ON "GSTReconciliationUpload"("companyId", "idempotencyKey");
CREATE INDEX "GSTReconciliationUpload_companyId_periodKey_createdAt_idx" ON "GSTReconciliationUpload"("companyId", "periodKey", "createdAt");
CREATE INDEX "GSTReconciliationUpload_companyId_status_idx" ON "GSTReconciliationUpload"("companyId", "status");

CREATE UNIQUE INDEX "GSTReconciliationLine_companyId_uploadId_rowNumber_key" ON "GSTReconciliationLine"("companyId", "uploadId", "rowNumber");
CREATE INDEX "GSTReconciliationLine_companyId_status_createdAt_idx" ON "GSTReconciliationLine"("companyId", "status", "createdAt");
CREATE INDEX "GSTReconciliationLine_companyId_invoiceNumber_idx" ON "GSTReconciliationLine"("companyId", "invoiceNumber");
CREATE INDEX "GSTReconciliationLine_companyId_bookDocumentId_idx" ON "GSTReconciliationLine"("companyId", "bookDocumentId");

CREATE UNIQUE INDEX "GSTAdjustment_companyId_id_key" ON "GSTAdjustment"("companyId", "id");
CREATE UNIQUE INDEX "GSTAdjustment_companyId_noteNumber_key" ON "GSTAdjustment"("companyId", "noteNumber");
CREATE UNIQUE INDEX "GSTAdjustment_companyId_voucherId_key" ON "GSTAdjustment"("companyId", "voucherId");
CREATE UNIQUE INDEX "GSTAdjustment_companyId_idempotencyKey_key" ON "GSTAdjustment"("companyId", "idempotencyKey");
CREATE INDEX "GSTAdjustment_companyId_periodKey_side_adjustmentType_idx" ON "GSTAdjustment"("companyId", "periodKey", "side", "adjustmentType");
CREATE INDEX "GSTAdjustment_companyId_noteDate_idx" ON "GSTAdjustment"("companyId", "noteDate");

CREATE INDEX "SalesDocumentLine_companyId_reverseCharge_idx" ON "SalesDocumentLine"("companyId", "reverseCharge");
CREATE INDEX "PurchaseDocumentLine_companyId_reverseCharge_idx" ON "PurchaseDocumentLine"("companyId", "reverseCharge");

-- Check constraints keep period and tax values valid even outside the API.
ALTER TABLE "GSTRegistration"
    ADD CONSTRAINT "GSTRegistration_stateCode_format_check" CHECK ("stateCode" ~ '^(0[1-9]|[1-2][0-9]|3[0-8])$'),
    ADD CONSTRAINT "GSTRegistration_gstin_state_check" CHECK (substring("gstin" FROM 1 FOR 2) = "stateCode"),
    ADD CONSTRAINT "GSTRegistration_filingFrequency_check" CHECK ("filingFrequency" IN ('MONTHLY', 'QUARTERLY'));
ALTER TABLE "GSTPeriod"
    ADD CONSTRAINT "GSTPeriod_periodKey_format_check" CHECK ("periodKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "GSTPeriodEvent"
    ADD CONSTRAINT "GSTPeriodEvent_reason_nonempty_check" CHECK (length(trim("reason")) > 0);
ALTER TABLE "GSTReconciliationUpload"
    ADD CONSTRAINT "GSTReconciliationUpload_periodKey_format_check" CHECK ("periodKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    ADD CONSTRAINT "GSTReconciliationUpload_counts_check"
        CHECK ("rowCount" >= 0 AND "matchedCount" >= 0 AND "mismatchCount" >= 0 AND "missingCount" >= 0
            AND "matchedCount" + "mismatchCount" + "missingCount" = "rowCount");
ALTER TABLE "GSTReconciliationLine"
    ADD CONSTRAINT "GSTReconciliationLine_rowNumber_check" CHECK ("rowNumber" >= 2),
    ADD CONSTRAINT "GSTReconciliationLine_amounts_nonnegative_check"
        CHECK ("taxableAmount" >= 0 AND "cgstAmount" >= 0 AND "sgstAmount" >= 0
            AND "utgstAmount" >= 0 AND "igstAmount" >= 0 AND "cessAmount" >= 0);
ALTER TABLE "GSTAdjustment"
    ADD CONSTRAINT "GSTAdjustment_periodKey_format_check" CHECK ("periodKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    ADD CONSTRAINT "GSTAdjustment_date_period_check" CHECK (to_char("noteDate", 'YYYY-MM') = "periodKey"),
    ADD CONSTRAINT "GSTAdjustment_amounts_nonnegative_check"
        CHECK ("taxableAmount" >= 0 AND "cgstAmount" >= 0 AND "sgstAmount" >= 0
            AND "utgstAmount" >= 0 AND "igstAmount" >= 0 AND "cessAmount" >= 0),
    ADD CONSTRAINT "GSTAdjustment_tax_jurisdiction_check"
        CHECK (NOT ("igstAmount" > 0 AND ("cgstAmount" > 0 OR "sgstAmount" > 0 OR "utgstAmount" > 0)
            OR ("sgstAmount" > 0 AND "utgstAmount" > 0)));
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_cessAmount_nonnegative_check" CHECK ("cessAmount" >= 0);
ALTER TABLE "SalesDocumentLine"
    ADD CONSTRAINT "SalesDocumentLine_cess_check" CHECK ("cessRate" BETWEEN 0 AND 100 AND "cessAmount" >= 0);
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_cessAmount_nonnegative_check" CHECK ("cessAmount" >= 0);
ALTER TABLE "PurchaseDocumentLine"
    ADD CONSTRAINT "PurchaseDocumentLine_cess_check" CHECK ("cessRate" BETWEEN 0 AND 100 AND "cessAmount" >= 0);

-- AddForeignKey
ALTER TABLE "GSTRegistration" ADD CONSTRAINT "GSTRegistration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GSTPeriod" ADD CONSTRAINT "GSTPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GSTPeriod" ADD CONSTRAINT "GSTPeriod_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GSTPeriodEvent" ADD CONSTRAINT "GSTPeriodEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GSTPeriodEvent" ADD CONSTRAINT "GSTPeriodEvent_companyId_periodId_fkey" FOREIGN KEY ("companyId", "periodId") REFERENCES "GSTPeriod"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GSTPeriodEvent" ADD CONSTRAINT "GSTPeriodEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GSTReconciliationUpload" ADD CONSTRAINT "GSTReconciliationUpload_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GSTReconciliationUpload" ADD CONSTRAINT "GSTReconciliationUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GSTReconciliationLine" ADD CONSTRAINT "GSTReconciliationLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GSTReconciliationLine" ADD CONSTRAINT "GSTReconciliationLine_companyId_uploadId_fkey" FOREIGN KEY ("companyId", "uploadId") REFERENCES "GSTReconciliationUpload"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GSTReconciliationLine" ADD CONSTRAINT "GSTReconciliationLine_companyId_bookDocumentId_fkey" FOREIGN KEY ("companyId", "bookDocumentId") REFERENCES "PurchaseDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GSTAdjustment" ADD CONSTRAINT "GSTAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GSTAdjustment" ADD CONSTRAINT "GSTAdjustment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GSTAdjustment" ADD CONSTRAINT "GSTAdjustment_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
