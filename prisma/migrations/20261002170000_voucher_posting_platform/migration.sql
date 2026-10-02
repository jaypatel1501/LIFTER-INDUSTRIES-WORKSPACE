ALTER TYPE "VoucherStatus" ADD VALUE 'DRAFT';
ALTER TYPE "VoucherStatus" ADD VALUE 'REVERSED';

CREATE TYPE "VoucherApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "VoucherTaxType" AS ENUM ('CGST', 'SGST', 'IGST', 'CESS', 'TDS', 'TCS', 'OTHER');
CREATE TYPE "BillReferenceType" AS ENUM ('NEW', 'AGAINST_REF', 'ON_ACCOUNT');
CREATE TYPE "DayBookEventType" AS ENUM (
  'DRAFT_CREATED', 'DRAFT_UPDATED', 'APPROVAL_REQUESTED', 'APPROVED',
  'REJECTED', 'POSTED', 'CANCELLED', 'REVERSED'
);
CREATE TYPE "VoucherAuditAction" AS ENUM (
  'CREATED', 'UPDATED', 'APPROVAL_REQUESTED', 'APPROVED',
  'REJECTED', 'POSTED', 'CANCELLED', 'REVERSED'
);

ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_companyId_id_key" UNIQUE ("companyId", "id");
ALTER TABLE "AccountingVoucher"
  ADD COLUMN "approvalStatus" "VoucherApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "financialYearId" TEXT,
  ADD COLUMN "numberSeriesId" TEXT,
  ADD COLUMN "postIdempotencyKey" TEXT,
  ADD COLUMN "postRequestHash" TEXT,
  ADD COLUMN "cancelIdempotencyKey" TEXT,
  ADD COLUMN "cancelRequestHash" TEXT,
  ADD COLUMN "reversalOfId" TEXT,
  ADD COLUMN "postedById" TEXT,
  ADD COLUMN "postedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "AccountingVoucher" ALTER COLUMN "status" SET DEFAULT 'POSTED';
ALTER TABLE "VoucherLine"
  ADD COLUMN "lineNumber" INTEGER NOT NULL DEFAULT 1;
WITH ranked_lines AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "companyId", "voucherId"
    ORDER BY "createdAt", "id"
  )::INTEGER AS "lineNumber"
  FROM "VoucherLine"
)
UPDATE "VoucherLine" line
SET "lineNumber" = ranked_lines."lineNumber"
FROM ranked_lines
WHERE line."id" = ranked_lines."id";

CREATE TABLE "VoucherNumberSeries" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherType" "VoucherType" NOT NULL,
  "financialYearId" TEXT,
  "periodKey" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "suffix" TEXT NOT NULL DEFAULT '',
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "padding" INTEGER NOT NULL DEFAULT 5,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VoucherNumberSeries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VoucherNumberSeries_number_check" CHECK ("nextNumber" > 0),
  CONSTRAINT "VoucherNumberSeries_padding_check" CHECK ("padding" BETWEEN 1 AND 12),
  CONSTRAINT "VoucherNumberSeries_prefix_check" CHECK (length("prefix") BETWEEN 1 AND 32)
);

CREATE TABLE "LedgerTransaction" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "voucherLineId" TEXT NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "transactionDate" DATE NOT NULL,
  "debit" DECIMAL(18,2) NOT NULL,
  "credit" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerTransaction_amount_check" CHECK ("debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0))
);

CREATE TABLE "VoucherTaxDetail" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherLineId" TEXT NOT NULL,
  "taxLedgerId" TEXT NOT NULL,
  "taxType" "VoucherTaxType" NOT NULL,
  "taxableAmount" DECIMAL(18,2) NOT NULL,
  "taxAmount" DECIMAL(18,2) NOT NULL,
  "rate" DECIMAL(7,4) NOT NULL,
  CONSTRAINT "VoucherTaxDetail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VoucherTaxDetail_amount_check" CHECK ("taxableAmount" >= 0 AND "taxAmount" >= 0 AND "rate" BETWEEN 0 AND 100)
);

CREATE TABLE "TaxTransaction" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "voucherLineId" TEXT NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "taxType" "VoucherTaxType" NOT NULL,
  "taxableAmount" DECIMAL(18,2) NOT NULL,
  "taxAmount" DECIMAL(18,2) NOT NULL,
  "rate" DECIMAL(7,4) NOT NULL,
  "transactionDate" DATE NOT NULL,
  "isReversal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaxTransaction_amount_check" CHECK ("taxableAmount" >= 0 AND "taxAmount" >= 0 AND "rate" BETWEEN 0 AND 100)
);

CREATE TABLE "BillWiseEntry" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "voucherLineId" TEXT NOT NULL,
  "referenceType" "BillReferenceType" NOT NULL,
  "referenceNumber" TEXT,
  "dueDate" DATE,
  "amount" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillWiseEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillWiseEntry_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "BillWiseEntry_reference_check" CHECK (
    ("referenceType" = 'ON_ACCOUNT' AND "referenceNumber" IS NULL) OR
    ("referenceType" <> 'ON_ACCOUNT' AND "referenceNumber" IS NOT NULL AND length("referenceNumber") > 0)
  )
);

CREATE TABLE "CostCentre" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostCentre_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostAllocation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "voucherLineId" TEXT NOT NULL,
  "costCentreId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostAllocation_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "VoucherStockDetail" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherLineId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "batchNumber" TEXT,
  "manufacturingDate" DATE,
  "expiryDate" DATE,
  "movementType" "InventoryMovementType" NOT NULL,
  "direction" "InventoryDirection" NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "unitCost" DECIMAL(18,4) NOT NULL,
  CONSTRAINT "VoucherStockDetail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VoucherStockDetail_amount_check" CHECK ("quantity" > 0 AND "unitCost" >= 0),
  CONSTRAINT "VoucherStockDetail_dates_check" CHECK ("manufacturingDate" IS NULL OR "expiryDate" IS NULL OR "manufacturingDate" <= "expiryDate")
);

CREATE TABLE "VoucherAttachment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoucherAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VoucherAttachment_size_check" CHECK ("byteSize" > 0 AND "byteSize" <= 10485760)
);

CREATE TABLE "VoucherApprovalAction" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "decision" "VoucherApprovalStatus" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoucherApprovalAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VoucherApprovalAction_decision_check" CHECK ("decision" IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE TABLE "VoucherAuditEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" "VoucherAuditAction" NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoucherAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DayBookEntry" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" "DayBookEventType" NOT NULL,
  "voucherType" "VoucherType" NOT NULL,
  "voucherNumber" TEXT NOT NULL,
  "voucherDate" DATE NOT NULL,
  "narration" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DayBookEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoucherNumberSeries_companyId_id_key" ON "VoucherNumberSeries"("companyId", "id");
CREATE UNIQUE INDEX "VoucherNumberSeries_companyId_voucherType_periodKey_key" ON "VoucherNumberSeries"("companyId", "voucherType", "periodKey");
CREATE INDEX "VoucherNumberSeries_companyId_financialYearId_isActive_idx" ON "VoucherNumberSeries"("companyId", "financialYearId", "isActive");
CREATE UNIQUE INDEX "VoucherLine_companyId_voucherId_lineNumber_key" ON "VoucherLine"("companyId", "voucherId", "lineNumber");
CREATE UNIQUE INDEX "AccountingVoucher_companyId_postIdempotencyKey_key" ON "AccountingVoucher"("companyId", "postIdempotencyKey");
CREATE UNIQUE INDEX "AccountingVoucher_companyId_cancelIdempotencyKey_key" ON "AccountingVoucher"("companyId", "cancelIdempotencyKey");
CREATE UNIQUE INDEX "AccountingVoucher_companyId_reversalOfId_key" ON "AccountingVoucher"("companyId", "reversalOfId");
CREATE INDEX "AccountingVoucher_companyId_financialYearId_status_idx" ON "AccountingVoucher"("companyId", "financialYearId", "status");
CREATE INDEX "AccountingVoucher_companyId_approvalStatus_createdAt_idx" ON "AccountingVoucher"("companyId", "approvalStatus", "createdAt");

CREATE UNIQUE INDEX "LedgerTransaction_companyId_voucherLineId_key" ON "LedgerTransaction"("companyId", "voucherLineId");
CREATE INDEX "LedgerTransaction_companyId_ledgerId_transactionDate_id_idx" ON "LedgerTransaction"("companyId", "ledgerId", "transactionDate", "id");
CREATE INDEX "LedgerTransaction_companyId_voucherId_idx" ON "LedgerTransaction"("companyId", "voucherId");

CREATE UNIQUE INDEX "VoucherTaxDetail_companyId_id_key" ON "VoucherTaxDetail"("companyId", "id");
CREATE INDEX "VoucherTaxDetail_companyId_voucherLineId_idx" ON "VoucherTaxDetail"("companyId", "voucherLineId");
CREATE UNIQUE INDEX "TaxTransaction_companyId_voucherLineId_taxType_key" ON "TaxTransaction"("companyId", "voucherLineId", "taxType");
CREATE INDEX "TaxTransaction_companyId_transactionDate_taxType_idx" ON "TaxTransaction"("companyId", "transactionDate", "taxType");
CREATE INDEX "TaxTransaction_companyId_ledgerId_transactionDate_idx" ON "TaxTransaction"("companyId", "ledgerId", "transactionDate");

CREATE UNIQUE INDEX "BillWiseEntry_companyId_id_key" ON "BillWiseEntry"("companyId", "id");
CREATE INDEX "BillWiseEntry_companyId_referenceNumber_idx" ON "BillWiseEntry"("companyId", "referenceNumber");
CREATE INDEX "BillWiseEntry_companyId_dueDate_idx" ON "BillWiseEntry"("companyId", "dueDate");
CREATE INDEX "BillWiseEntry_companyId_voucherId_idx" ON "BillWiseEntry"("companyId", "voucherId");

CREATE UNIQUE INDEX "CostCentre_companyId_id_key" ON "CostCentre"("companyId", "id");
CREATE UNIQUE INDEX "CostCentre_companyId_name_key" ON "CostCentre"("companyId", "name");
CREATE UNIQUE INDEX "CostCentre_companyId_code_key" ON "CostCentre"("companyId", "code");
CREATE INDEX "CostCentre_companyId_isActive_name_idx" ON "CostCentre"("companyId", "isActive", "name");
CREATE UNIQUE INDEX "CostAllocation_companyId_id_key" ON "CostAllocation"("companyId", "id");
CREATE INDEX "CostAllocation_companyId_costCentreId_voucherId_idx" ON "CostAllocation"("companyId", "costCentreId", "voucherId");
CREATE INDEX "CostAllocation_companyId_voucherLineId_idx" ON "CostAllocation"("companyId", "voucherLineId");

CREATE UNIQUE INDEX "VoucherStockDetail_companyId_voucherLineId_key" ON "VoucherStockDetail"("companyId", "voucherLineId");
CREATE INDEX "VoucherStockDetail_companyId_itemId_warehouseId_idx" ON "VoucherStockDetail"("companyId", "itemId", "warehouseId");

CREATE UNIQUE INDEX "VoucherAttachment_companyId_id_key" ON "VoucherAttachment"("companyId", "id");
CREATE UNIQUE INDEX "VoucherAttachment_companyId_objectKey_key" ON "VoucherAttachment"("companyId", "objectKey");
CREATE INDEX "VoucherAttachment_companyId_voucherId_idx" ON "VoucherAttachment"("companyId", "voucherId");

CREATE UNIQUE INDEX "VoucherApprovalAction_companyId_id_key" ON "VoucherApprovalAction"("companyId", "id");
CREATE UNIQUE INDEX "VoucherApprovalAction_companyId_idempotencyKey_key" ON "VoucherApprovalAction"("companyId", "idempotencyKey");
CREATE INDEX "VoucherApprovalAction_companyId_voucherId_createdAt_idx" ON "VoucherApprovalAction"("companyId", "voucherId", "createdAt");
CREATE UNIQUE INDEX "VoucherAuditEvent_companyId_id_key" ON "VoucherAuditEvent"("companyId", "id");
CREATE INDEX "VoucherAuditEvent_companyId_voucherId_createdAt_idx" ON "VoucherAuditEvent"("companyId", "voucherId", "createdAt");
CREATE UNIQUE INDEX "DayBookEntry_companyId_id_key" ON "DayBookEntry"("companyId", "id");
CREATE INDEX "DayBookEntry_companyId_voucherDate_voucherType_id_idx" ON "DayBookEntry"("companyId", "voucherDate", "voucherType", "id");
CREATE INDEX "DayBookEntry_companyId_eventType_createdAt_idx" ON "DayBookEntry"("companyId", "eventType", "createdAt");

ALTER TABLE "VoucherNumberSeries" ADD CONSTRAINT "VoucherNumberSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoucherNumberSeries" ADD CONSTRAINT "VoucherNumberSeries_companyId_financialYearId_fkey" FOREIGN KEY ("companyId", "financialYearId") REFERENCES "FinancialYear"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_companyId_financialYearId_fkey" FOREIGN KEY ("companyId", "financialYearId") REFERENCES "FinancialYear"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_companyId_numberSeriesId_fkey" FOREIGN KEY ("companyId", "numberSeriesId") REFERENCES "VoucherNumberSeries"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_companyId_reversalOfId_fkey" FOREIGN KEY ("companyId", "reversalOfId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_lineNumber_check" CHECK ("lineNumber" > 0);

ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_companyId_voucherLineId_fkey" FOREIGN KEY ("companyId", "voucherLineId") REFERENCES "VoucherLine"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_companyId_ledgerId_fkey" FOREIGN KEY ("companyId", "ledgerId") REFERENCES "Ledger"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VoucherTaxDetail" ADD CONSTRAINT "VoucherTaxDetail_companyId_voucherLineId_fkey" FOREIGN KEY ("companyId", "voucherLineId") REFERENCES "VoucherLine"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherTaxDetail" ADD CONSTRAINT "VoucherTaxDetail_companyId_taxLedgerId_fkey" FOREIGN KEY ("companyId", "taxLedgerId") REFERENCES "Ledger"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxTransaction" ADD CONSTRAINT "TaxTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxTransaction" ADD CONSTRAINT "TaxTransaction_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxTransaction" ADD CONSTRAINT "TaxTransaction_companyId_voucherLineId_fkey" FOREIGN KEY ("companyId", "voucherLineId") REFERENCES "VoucherLine"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxTransaction" ADD CONSTRAINT "TaxTransaction_companyId_ledgerId_fkey" FOREIGN KEY ("companyId", "ledgerId") REFERENCES "Ledger"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillWiseEntry" ADD CONSTRAINT "BillWiseEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillWiseEntry" ADD CONSTRAINT "BillWiseEntry_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillWiseEntry" ADD CONSTRAINT "BillWiseEntry_companyId_voucherLineId_fkey" FOREIGN KEY ("companyId", "voucherLineId") REFERENCES "VoucherLine"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostCentre" ADD CONSTRAINT "CostCentre_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_companyId_voucherLineId_fkey" FOREIGN KEY ("companyId", "voucherLineId") REFERENCES "VoucherLine"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_companyId_costCentreId_fkey" FOREIGN KEY ("companyId", "costCentreId") REFERENCES "CostCentre"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VoucherStockDetail" ADD CONSTRAINT "VoucherStockDetail_companyId_voucherLineId_fkey" FOREIGN KEY ("companyId", "voucherLineId") REFERENCES "VoucherLine"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherStockDetail" ADD CONSTRAINT "VoucherStockDetail_companyId_itemId_fkey" FOREIGN KEY ("companyId", "itemId") REFERENCES "StockItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherStockDetail" ADD CONSTRAINT "VoucherStockDetail_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VoucherAttachment" ADD CONSTRAINT "VoucherAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherAttachment" ADD CONSTRAINT "VoucherAttachment_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherAttachment" ADD CONSTRAINT "VoucherAttachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VoucherApprovalAction" ADD CONSTRAINT "VoucherApprovalAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherApprovalAction" ADD CONSTRAINT "VoucherApprovalAction_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherApprovalAction" ADD CONSTRAINT "VoucherApprovalAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VoucherAuditEvent" ADD CONSTRAINT "VoucherAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherAuditEvent" ADD CONSTRAINT "VoucherAuditEvent_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherAuditEvent" ADD CONSTRAINT "VoucherAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DayBookEntry" ADD CONSTRAINT "DayBookEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DayBookEntry" ADD CONSTRAINT "DayBookEntry_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DayBookEntry" ADD CONSTRAINT "DayBookEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "resource", "action", "description")
SELECT gen_random_uuid()::text, catalog."resource", catalog."action", catalog."description"
FROM (VALUES
  ('vouchers', 'create', 'Create voucher drafts'),
  ('vouchers', 'update', 'Edit voucher drafts'),
  ('vouchers', 'post', 'Post balanced vouchers'),
  ('vouchers', 'cancel', 'Cancel voucher drafts'),
  ('vouchers', 'reverse', 'Reverse posted vouchers'),
  ('vouchers', 'approve', 'Approve or reject vouchers'),
  ('voucher-series', 'manage', 'Manage voucher number series'),
  ('cost-centres', 'manage', 'Manage cost centres')
) AS catalog("resource", "action", "description")
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role_row."id", permission_row."id"
FROM "Role" AS role_row
CROSS JOIN "Permission" AS permission_row
WHERE role_row."name" = 'Owner' AND role_row."isSystem" = true
  AND permission_row."resource" IN ('vouchers', 'voucher-series', 'cost-centres')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "VoucherNumberSeries"
  ("id", "companyId", "voucherType", "financialYearId", "periodKey", "prefix", "nextNumber", "padding", "createdAt", "updatedAt")
SELECT
  'vns' || md5(company."id" || ':' || voucher_types."type" || ':DEFAULT'),
  company."id",
  voucher_types."type"::"VoucherType",
  NULL,
  'DEFAULT',
  voucher_types."prefix",
  1,
  5,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" company
CROSS JOIN (VALUES
  ('OPENING_BALANCE', 'OB-'), ('JOURNAL', 'JV-'), ('SALES', 'SAL-'),
  ('PURCHASE', 'PUR-'), ('PAYMENT', 'PAY-'), ('RECEIPT', 'REC-'), ('CONTRA', 'CON-')
) AS voucher_types("type", "prefix")
ON CONFLICT ("companyId", "voucherType", "periodKey") DO NOTHING;

INSERT INTO "VoucherNumberSeries"
  ("id", "companyId", "voucherType", "financialYearId", "periodKey", "prefix", "nextNumber", "padding", "createdAt", "updatedAt")
SELECT
  'vns' || md5(company."id" || ':' || voucher_types."type" || ':' || financial_year."id"),
  company."id",
  voucher_types."type"::"VoucherType",
  financial_year."id",
  financial_year."id",
  voucher_types."prefix" || right(financial_year."name", 2) || '-',
  1,
  5,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" company
JOIN "FinancialYear" financial_year ON financial_year."companyId" = company."id"
CROSS JOIN (VALUES
  ('OPENING_BALANCE', 'OB-'), ('JOURNAL', 'JV-'), ('SALES', 'SAL-'),
  ('PURCHASE', 'PUR-'), ('PAYMENT', 'PAY-'), ('RECEIPT', 'REC-'), ('CONTRA', 'CON-')
) AS voucher_types("type", "prefix")
ON CONFLICT ("companyId", "voucherType", "periodKey") DO NOTHING;

INSERT INTO "LedgerTransaction"
  ("id", "companyId", "voucherId", "voucherLineId", "ledgerId", "transactionDate", "debit", "credit", "createdAt")
SELECT
  'lt' || md5(line."companyId" || ':' || line."id"),
  line."companyId",
  line."voucherId",
  line."id",
  line."ledgerId",
  voucher."voucherDate",
  line."debit",
  line."credit",
  line."createdAt"
FROM "VoucherLine" line
JOIN "AccountingVoucher" voucher ON voucher."companyId" = line."companyId" AND voucher."id" = line."voucherId"
WHERE voucher."status" = 'POSTED'
ON CONFLICT ("companyId", "voucherLineId") DO NOTHING;

INSERT INTO "DayBookEntry"
  ("id", "companyId", "voucherId", "actorId", "eventType", "voucherType", "voucherNumber", "voucherDate", "narration", "createdAt")
SELECT
  'dbe' || md5(voucher."companyId" || ':' || voucher."id" || ':POSTED'),
  voucher."companyId",
  voucher."id",
  voucher."createdById",
  'POSTED',
  voucher."type",
  voucher."voucherNumber",
  voucher."voucherDate",
  voucher."narration",
  voucher."createdAt"
FROM "AccountingVoucher" voucher
WHERE voucher."status" = 'POSTED'
ON CONFLICT DO NOTHING;
