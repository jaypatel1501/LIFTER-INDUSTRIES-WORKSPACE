ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'SALES_RETURN';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'CREDIT_NOTE';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'DEBIT_NOTE';
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK', 'CHEQUE', 'UPI', 'NEFT', 'RTGS');

ALTER TABLE "AccountingVoucher"
  ADD COLUMN "paymentMethod" "PaymentMethod",
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "paymentDate" DATE,
  ADD COLUMN "paymentBank" TEXT;

ALTER TABLE "BillWiseEntry"
  ADD COLUMN "settlesEntryId" TEXT,
  ADD COLUMN "settlesOpeningId" TEXT,
  ADD COLUMN "settledAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "remainingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "BillWiseOpening"
  ADD COLUMN "settledAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "remainingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "AccountingVoucher_companyId_paymentReference_key" ON "AccountingVoucher"("companyId", "paymentReference");
CREATE UNIQUE INDEX "BillWiseOpening_companyId_id_key" ON "BillWiseOpening"("companyId", "id");
CREATE INDEX "BillWiseEntry_companyId_settlesEntryId_idx" ON "BillWiseEntry"("companyId", "settlesEntryId");
CREATE INDEX "BillWiseEntry_companyId_settlesOpeningId_idx" ON "BillWiseEntry"("companyId", "settlesOpeningId");
CREATE INDEX "BillWiseEntry_companyId_remainingAmount_dueDate_idx" ON "BillWiseEntry"("companyId", "remainingAmount", "dueDate");
CREATE INDEX "BillWiseOpening_companyId_remainingAmount_dueDate_idx" ON "BillWiseOpening"("companyId", "remainingAmount", "dueDate");

ALTER TABLE "BillWiseEntry" ADD CONSTRAINT "BillWiseEntry_companyId_settlesEntryId_fkey"
  FOREIGN KEY ("companyId", "settlesEntryId") REFERENCES "BillWiseEntry"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillWiseEntry" ADD CONSTRAINT "BillWiseEntry_companyId_settlesOpeningId_fkey"
  FOREIGN KEY ("companyId", "settlesOpeningId") REFERENCES "BillWiseOpening"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "BillWiseEntry" SET "remainingAmount" = "amount"
WHERE "referenceType" = 'NEW';
UPDATE "BillWiseOpening" SET "remainingAmount" = "amount";

WITH legacy_activity AS (
  SELECT source."id" AS "sourceId",
    SUM(CASE
      WHEN party."type" = 'CUSTOMER' AND line."debit" > line."credit" THEN activity."amount"
      WHEN party."type" = 'CUSTOMER' THEN -activity."amount"
      WHEN party."type" = 'SUPPLIER' AND line."credit" > line."debit" THEN activity."amount"
      ELSE -activity."amount"
    END) AS "balance"
  FROM "BillWiseEntry" source
  JOIN "VoucherLine" source_line ON source_line."companyId" = source."companyId" AND source_line."id" = source."voucherLineId"
  JOIN "AccountingVoucher" source_voucher ON source_voucher."companyId" = source."companyId" AND source_voucher."id" = source."voucherId"
  JOIN "Ledger" ledger ON ledger."companyId" = source_line."companyId" AND ledger."id" = source_line."ledgerId"
  JOIN "Party" party ON party."companyId" = ledger."companyId" AND party."id" = ledger."partyId"
  JOIN "BillWiseEntry" activity ON activity."companyId" = source."companyId" AND activity."referenceNumber" = source."referenceNumber"
  JOIN "VoucherLine" line ON line."companyId" = activity."companyId" AND line."id" = activity."voucherLineId" AND line."ledgerId" = source_line."ledgerId"
  JOIN "AccountingVoucher" activity_voucher ON activity_voucher."companyId" = activity."companyId" AND activity_voucher."id" = activity."voucherId"
  WHERE source."referenceType" = 'NEW'
    AND source_voucher."status" IN ('POSTED', 'REVERSED')
    AND activity."referenceType" IN ('NEW', 'AGAINST_REF')
    AND activity_voucher."status" IN ('POSTED', 'REVERSED')
  GROUP BY source."id"
)
UPDATE "BillWiseEntry" source
SET "remainingAmount" = LEAST(source."amount", GREATEST(0, COALESCE(legacy_activity."balance", source."amount"))),
    "settledAmount" = source."amount" - LEAST(source."amount", GREATEST(0, COALESCE(legacy_activity."balance", source."amount")))
FROM legacy_activity
WHERE source."id" = legacy_activity."sourceId";

WITH opening_activity AS (
  SELECT opening."id" AS "openingId",
    SUM(CASE
      WHEN party."type" = 'CUSTOMER' AND line."debit" > line."credit" THEN activity."amount"
      WHEN party."type" = 'CUSTOMER' THEN -activity."amount"
      WHEN party."type" = 'SUPPLIER' AND line."credit" > line."debit" THEN activity."amount"
      ELSE -activity."amount"
    END) AS "change"
  FROM "BillWiseOpening" opening
  JOIN "VoucherLine" source_line ON source_line."companyId" = opening."companyId" AND source_line."id" = opening."voucherLineId"
  JOIN "Ledger" ledger ON ledger."companyId" = source_line."companyId" AND ledger."id" = source_line."ledgerId"
  JOIN "Party" party ON party."companyId" = ledger."companyId" AND party."id" = ledger."partyId"
  JOIN "BillWiseEntry" activity ON activity."companyId" = opening."companyId" AND activity."referenceNumber" = opening."referenceNumber" AND activity."referenceType" = 'AGAINST_REF'
  JOIN "VoucherLine" line ON line."companyId" = activity."companyId" AND line."id" = activity."voucherLineId" AND line."ledgerId" = source_line."ledgerId"
  JOIN "AccountingVoucher" activity_voucher ON activity_voucher."companyId" = activity."companyId" AND activity_voucher."id" = activity."voucherId"
  WHERE activity_voucher."status" IN ('POSTED', 'REVERSED')
  GROUP BY opening."id"
)
UPDATE "BillWiseOpening" opening
SET "remainingAmount" = CASE WHEN source_voucher."status" = 'REVERSED' THEN 0
  ELSE LEAST(opening."amount", GREATEST(0, opening."amount" + COALESCE((SELECT opening_activity."change" FROM opening_activity WHERE opening_activity."openingId" = opening."id"), 0))) END,
    "settledAmount" = opening."amount" - CASE WHEN source_voucher."status" = 'REVERSED' THEN 0
  ELSE LEAST(opening."amount", GREATEST(0, opening."amount" + COALESCE((SELECT opening_activity."change" FROM opening_activity WHERE opening_activity."openingId" = opening."id"), 0))) END
FROM "VoucherLine" source_line
JOIN "AccountingVoucher" source_voucher ON source_voucher."companyId" = source_line."companyId" AND source_voucher."id" = source_line."voucherId"
WHERE source_line."companyId" = opening."companyId" AND source_line."id" = opening."voucherLineId"
;

WITH legacy_links AS (
  SELECT settlement."id" AS "settlementId",
    MIN(source."id") AS "sourceEntryId",
    MIN(opening."id") AS "sourceOpeningId"
  FROM "BillWiseEntry" settlement
  JOIN "VoucherLine" settlement_line ON settlement_line."companyId" = settlement."companyId" AND settlement_line."id" = settlement."voucherLineId"
  LEFT JOIN "BillWiseEntry" source ON source."companyId" = settlement."companyId"
    AND source."referenceType" = 'NEW' AND source."referenceNumber" = settlement."referenceNumber"
    AND source."voucherId" IN (SELECT source_voucher."id" FROM "AccountingVoucher" source_voucher WHERE source_voucher."companyId" = settlement."companyId" AND source_voucher."status" IN ('POSTED', 'REVERSED'))
    AND source."voucherLineId" IN (SELECT source_line."id" FROM "VoucherLine" source_line WHERE source_line."companyId" = settlement."companyId" AND source_line."ledgerId" = settlement_line."ledgerId")
  LEFT JOIN "BillWiseOpening" opening ON opening."companyId" = settlement."companyId"
    AND opening."referenceNumber" = settlement."referenceNumber"
    AND opening."voucherLineId" IN (SELECT source_line."id" FROM "VoucherLine" source_line WHERE source_line."companyId" = settlement."companyId" AND source_line."ledgerId" = settlement_line."ledgerId")
  WHERE settlement."referenceType" = 'AGAINST_REF'
  GROUP BY settlement."id"
  HAVING COUNT(DISTINCT source."id") + COUNT(DISTINCT opening."id") = 1
)
UPDATE "BillWiseEntry" settlement
SET "settlesEntryId" = legacy_links."sourceEntryId",
    "settlesOpeningId" = legacy_links."sourceOpeningId"
FROM legacy_links
WHERE settlement."id" = legacy_links."settlementId";

ALTER TABLE "BillWiseEntry" ADD CONSTRAINT "BillWiseEntry_settlement_amounts_check"
  CHECK ("settledAmount" >= 0 AND "remainingAmount" >= 0 AND "settledAmount" + "remainingAmount" <= "amount");
ALTER TABLE "BillWiseEntry" ADD CONSTRAINT "BillWiseEntry_settlement_link_check"
  CHECK (NOT ("settlesEntryId" IS NOT NULL AND "settlesOpeningId" IS NOT NULL));
ALTER TABLE "BillWiseOpening" ADD CONSTRAINT "BillWiseOpening_settlement_amounts_check"
  CHECK ("settledAmount" >= 0 AND "remainingAmount" >= 0 AND "settledAmount" + "remainingAmount" = "amount");
