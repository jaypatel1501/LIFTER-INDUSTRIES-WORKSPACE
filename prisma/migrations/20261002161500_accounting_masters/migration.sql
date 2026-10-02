CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER');
CREATE TYPE "LedgerType" AS ENUM ('GENERAL', 'CASH', 'BANK', 'TAX', 'INCOME', 'EXPENSE', 'PARTY');
CREATE TYPE "AccountNature" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');
CREATE TYPE "VoucherType" AS ENUM ('OPENING_BALANCE', 'JOURNAL', 'SALES', 'PURCHASE', 'PAYMENT', 'RECEIPT', 'CONTRA');
CREATE TYPE "VoucherStatus" AS ENUM ('POSTED', 'CANCELLED');

CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "PartyType" NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "creditPeriodDays" INTEGER NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creationKey" TEXT NOT NULL,
    "creationHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Party_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Party_creditPeriodDays_check" CHECK ("creditPeriodDays" >= 0),
    CONSTRAINT "Party_creditLimit_check" CHECK ("creditLimit" >= 0),
    CONSTRAINT "Party_gstin_format_check" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
    CONSTRAINT "Party_pan_format_check" CHECK ("pan" IS NULL OR "pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
    CONSTRAINT "Party_stateCode_format_check" CHECK ("stateCode" IS NULL OR "stateCode" ~ '^[0-9]{2}$')
);

CREATE TABLE "LedgerGroup" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nature" "AccountNature" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LedgerGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Ledger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "partyId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "LedgerType" NOT NULL DEFAULT 'GENERAL',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "costCentreEnabled" BOOLEAN NOT NULL DEFAULT false,
    "interestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "interestRate" DECIMAL(7,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creationKey" TEXT NOT NULL,
    "creationHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Ledger_interestRate_check" CHECK ("interestRate" IS NULL OR ("interestRate" >= 0 AND "interestRate" <= 100))
);

CREATE TABLE "AccountingVoucher" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "type" "VoucherType" NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'POSTED',
    "voucherDate" DATE NOT NULL,
    "narration" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountingVoucher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoucherLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "description" TEXT,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoucherLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VoucherLine_one_side_check" CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))
);

CREATE TABLE "BillWiseOpening" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "voucherLineId" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillWiseOpening_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BillWiseOpening_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "Party_companyId_id_key" ON "Party"("companyId", "id");
CREATE UNIQUE INDEX "Party_companyId_creationKey_key" ON "Party"("companyId", "creationKey");
CREATE UNIQUE INDEX "Party_companyId_gstin_key" ON "Party"("companyId", "gstin");
CREATE INDEX "Party_companyId_type_isActive_name_idx" ON "Party"("companyId", "type", "isActive", "name");
CREATE INDEX "Party_companyId_pan_idx" ON "Party"("companyId", "pan");
CREATE INDEX "Party_companyId_stateCode_idx" ON "Party"("companyId", "stateCode");

CREATE UNIQUE INDEX "LedgerGroup_companyId_id_key" ON "LedgerGroup"("companyId", "id");
CREATE UNIQUE INDEX "LedgerGroup_companyId_name_key" ON "LedgerGroup"("companyId", "name");
CREATE UNIQUE INDEX "LedgerGroup_companyId_code_key" ON "LedgerGroup"("companyId", "code");
CREATE INDEX "LedgerGroup_companyId_parentId_idx" ON "LedgerGroup"("companyId", "parentId");
CREATE INDEX "LedgerGroup_companyId_nature_idx" ON "LedgerGroup"("companyId", "nature");

CREATE UNIQUE INDEX "Ledger_companyId_id_key" ON "Ledger"("companyId", "id");
CREATE UNIQUE INDEX "Ledger_companyId_name_key" ON "Ledger"("companyId", "name");
CREATE UNIQUE INDEX "Ledger_companyId_code_key" ON "Ledger"("companyId", "code");
CREATE UNIQUE INDEX "Ledger_companyId_partyId_key" ON "Ledger"("companyId", "partyId");
CREATE UNIQUE INDEX "Ledger_companyId_creationKey_key" ON "Ledger"("companyId", "creationKey");
CREATE INDEX "Ledger_companyId_groupId_isActive_name_idx" ON "Ledger"("companyId", "groupId", "isActive", "name");
CREATE INDEX "Ledger_companyId_type_isActive_idx" ON "Ledger"("companyId", "type", "isActive");

CREATE UNIQUE INDEX "AccountingVoucher_companyId_id_key" ON "AccountingVoucher"("companyId", "id");
CREATE UNIQUE INDEX "AccountingVoucher_companyId_voucherNumber_key" ON "AccountingVoucher"("companyId", "voucherNumber");
CREATE UNIQUE INDEX "AccountingVoucher_companyId_idempotencyKey_key" ON "AccountingVoucher"("companyId", "idempotencyKey");
CREATE INDEX "AccountingVoucher_companyId_type_voucherDate_idx" ON "AccountingVoucher"("companyId", "type", "voucherDate");
CREATE INDEX "AccountingVoucher_companyId_status_voucherDate_idx" ON "AccountingVoucher"("companyId", "status", "voucherDate");

CREATE UNIQUE INDEX "VoucherLine_companyId_id_key" ON "VoucherLine"("companyId", "id");
CREATE INDEX "VoucherLine_companyId_ledgerId_voucherId_idx" ON "VoucherLine"("companyId", "ledgerId", "voucherId");
CREATE INDEX "VoucherLine_companyId_voucherId_idx" ON "VoucherLine"("companyId", "voucherId");
CREATE UNIQUE INDEX "BillWiseOpening_companyId_voucherLineId_referenceNumber_key" ON "BillWiseOpening"("companyId", "voucherLineId", "referenceNumber");
CREATE INDEX "BillWiseOpening_companyId_dueDate_idx" ON "BillWiseOpening"("companyId", "dueDate");

ALTER TABLE "Party" ADD CONSTRAINT "Party_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerGroup" ADD CONSTRAINT "LedgerGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerGroup" ADD CONSTRAINT "LedgerGroup_companyId_parentId_fkey" FOREIGN KEY ("companyId", "parentId") REFERENCES "LedgerGroup"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_companyId_groupId_fkey" FOREIGN KEY ("companyId", "groupId") REFERENCES "LedgerGroup"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_companyId_partyId_fkey" FOREIGN KEY ("companyId", "partyId") REFERENCES "Party"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingVoucher" ADD CONSTRAINT "AccountingVoucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_companyId_ledgerId_fkey" FOREIGN KEY ("companyId", "ledgerId") REFERENCES "Ledger"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillWiseOpening" ADD CONSTRAINT "BillWiseOpening_companyId_voucherLineId_fkey" FOREIGN KEY ("companyId", "voucherLineId") REFERENCES "VoucherLine"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "resource", "action", "description")
SELECT gen_random_uuid()::text, catalog."resource", catalog."action", catalog."description"
FROM (VALUES
    ('parties', 'read', 'View customers and suppliers'),
    ('parties', 'create', 'Create customers and suppliers'),
    ('parties', 'update', 'Update customers and suppliers'),
    ('ledgers', 'read', 'View ledgers and accounting reports'),
    ('ledgers', 'create', 'Create ledgers'),
    ('ledgers', 'update', 'Update ledgers'),
    ('ledger-groups', 'read', 'View ledger groups'),
    ('ledger-groups', 'manage', 'Manage ledger groups'),
    ('vouchers', 'read', 'View voucher history and trial balance')
) AS catalog("resource", "action", "description")
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r CROSS JOIN "Permission" AS p
WHERE r."name" = 'Owner' AND r."isSystem" = true
  AND p."resource" IN ('parties', 'ledgers', 'ledger-groups', 'vouchers')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

WITH catalog("code", "name", "nature", "parentCode") AS (
  VALUES
    ('CAPITAL', 'Capital Account', 'EQUITY', NULL::TEXT),
    ('RESERVES', 'Reserves & Surplus', 'EQUITY', 'CAPITAL'),
    ('LOANS', 'Loans (Liability)', 'LIABILITY', NULL),
    ('SECURED_LOANS', 'Secured Loans', 'LIABILITY', 'LOANS'),
    ('UNSECURED_LOANS', 'Unsecured Loans', 'LIABILITY', 'LOANS'),
    ('CURRENT_LIABILITIES', 'Current Liabilities', 'LIABILITY', NULL),
    ('SUNDRY_CREDITORS', 'Sundry Creditors', 'LIABILITY', 'CURRENT_LIABILITIES'),
    ('DUTIES_TAXES', 'Duties & Taxes', 'LIABILITY', 'CURRENT_LIABILITIES'),
    ('FIXED_ASSETS', 'Fixed Assets', 'ASSET', NULL),
    ('INVESTMENTS', 'Investments', 'ASSET', NULL),
    ('CURRENT_ASSETS', 'Current Assets', 'ASSET', NULL),
    ('SUNDRY_DEBTORS', 'Sundry Debtors', 'ASSET', 'CURRENT_ASSETS'),
    ('CASH_IN_HAND', 'Cash-in-Hand', 'ASSET', 'CURRENT_ASSETS'),
    ('BANK_ACCOUNTS', 'Bank Accounts', 'ASSET', 'CURRENT_ASSETS'),
    ('STOCK_IN_HAND', 'Stock-in-Hand', 'ASSET', 'CURRENT_ASSETS'),
    ('DIRECT_INCOME', 'Direct Incomes', 'INCOME', NULL),
    ('INDIRECT_INCOME', 'Indirect Incomes', 'INCOME', NULL),
    ('DIRECT_EXPENSES', 'Direct Expenses', 'EXPENSE', NULL),
    ('INDIRECT_EXPENSES', 'Indirect Expenses', 'EXPENSE', NULL)
)
INSERT INTO "LedgerGroup" ("id", "companyId", "parentId", "name", "code", "nature", "isSystem", "createdAt", "updatedAt")
SELECT
  'g' || md5(company."id" || ':' || catalog."code"),
  company."id",
  CASE WHEN catalog."parentCode" IS NULL THEN NULL
       ELSE 'g' || md5(company."id" || ':' || catalog."parentCode") END,
  catalog."name",
  catalog."code",
  catalog."nature"::"AccountNature",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" AS company CROSS JOIN catalog
ON CONFLICT ("companyId", "code") DO NOTHING;

INSERT INTO "Ledger" ("id", "companyId", "groupId", "name", "code", "type", "isSystem", "creationKey", "creationHash", "createdAt", "updatedAt")
SELECT
  'l' || md5(company."id" || ':OPENING_BALANCE_DIFFERENCE'),
  company."id",
  group_row."id",
  'Opening Balance Difference',
  'OPENING_BALANCE_DIFFERENCE',
  'GENERAL',
  true,
  '',
  '',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" AS company
JOIN "LedgerGroup" AS group_row
  ON group_row."companyId" = company."id" AND group_row."code" = 'CAPITAL'
ON CONFLICT ("companyId", "code") DO NOTHING;
