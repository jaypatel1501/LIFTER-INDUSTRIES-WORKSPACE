-- CreateEnum
CREATE TYPE "SalesDocumentType" AS ENUM ('QUOTATION', 'SALES_ORDER', 'DELIVERY_NOTE', 'SALES_INVOICE');

-- CreateEnum
CREATE TYPE "SalesDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'PARTIALLY_INVOICED', 'INVOICED', 'POSTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "SalesPaymentMode" AS ENUM ('CASH', 'CREDIT');

-- CreateEnum
CREATE TYPE "SalesInvoiceNature" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "SalesDocumentEventType" AS ENUM ('CREATED', 'ISSUED', 'ACCEPTED', 'REJECTED', 'ORDER_CREATED', 'DELIVERY_POSTED', 'INVOICE_POSTED', 'CANCELLED', 'REVERSED', 'EMAIL_SENT', 'WHATSAPP_SENT');

-- AlterEnum
ALTER TYPE "VoucherTaxType" ADD VALUE 'UTGST';

-- CreateTable
CREATE TABLE "SalesNumberSeries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" "SalesDocumentType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "suffix" TEXT NOT NULL DEFAULT '',
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesNumberSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentType" "SalesDocumentType" NOT NULL,
    "status" "SalesDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "partyId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "voucherId" TEXT,
    "numberSeriesId" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "dueDate" DATE,
    "validUntil" DATE,
    "paymentMode" "SalesPaymentMode",
    "invoiceNature" "SalesInvoiceNature",
    "paymentLedgerId" TEXT,
    "billingAddress" JSONB NOT NULL,
    "shippingAddress" JSONB NOT NULL,
    "companySnapshot" JSONB NOT NULL,
    "partySnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "freight" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "utgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "costOfGoodsSold" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "postIdempotencyKey" TEXT,
    "postRequestHash" TEXT,
    "cancelIdempotencyKey" TEXT,
    "cancelRequestHash" TEXT,
    "createdById" TEXT,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDocumentLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "itemId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsnSac" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "deliveredQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "invoicedQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitRate" DECIMAL(18,4) NOT NULL,
    "discountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,2) NOT NULL,
    "gstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "cgstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "sgstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "utgstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "igstRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "cgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "utgstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "warehouseId" TEXT,
    "batchNumber" TEXT,
    "manufacturingDate" DATE,
    "expiryDate" DATE,
    "unitCost" DECIMAL(18,4),

    CONSTRAINT "SalesDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDocumentEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" "SalesDocumentEventType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesDocumentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesNumberSeries_companyId_isActive_documentType_idx" ON "SalesNumberSeries"("companyId", "isActive", "documentType");

-- CreateIndex
CREATE UNIQUE INDEX "SalesNumberSeries_companyId_id_key" ON "SalesNumberSeries"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesNumberSeries_companyId_documentType_periodKey_key" ON "SalesNumberSeries"("companyId", "documentType", "periodKey");

-- CreateIndex
CREATE INDEX "SalesDocument_companyId_documentType_status_documentDate_idx" ON "SalesDocument"("companyId", "documentType", "status", "documentDate");

-- CreateIndex
CREATE INDEX "SalesDocument_companyId_partyId_documentDate_idx" ON "SalesDocument"("companyId", "partyId", "documentDate");

-- CreateIndex
CREATE INDEX "SalesDocument_companyId_sourceDocumentId_documentType_idx" ON "SalesDocument"("companyId", "sourceDocumentId", "documentType");

-- CreateIndex
CREATE INDEX "SalesDocument_companyId_status_dueDate_idx" ON "SalesDocument"("companyId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_companyId_id_key" ON "SalesDocument"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_companyId_documentNumber_key" ON "SalesDocument"("companyId", "documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_companyId_idempotencyKey_key" ON "SalesDocument"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_companyId_voucherId_key" ON "SalesDocument"("companyId", "voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_companyId_postIdempotencyKey_key" ON "SalesDocument"("companyId", "postIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_companyId_cancelIdempotencyKey_key" ON "SalesDocument"("companyId", "cancelIdempotencyKey");

-- CreateIndex
CREATE INDEX "SalesDocumentLine_companyId_itemId_documentId_idx" ON "SalesDocumentLine"("companyId", "itemId", "documentId");

-- CreateIndex
CREATE INDEX "SalesDocumentLine_companyId_sourceLineId_idx" ON "SalesDocumentLine"("companyId", "sourceLineId");

-- CreateIndex
CREATE INDEX "SalesDocumentLine_companyId_warehouseId_batchNumber_idx" ON "SalesDocumentLine"("companyId", "warehouseId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocumentLine_companyId_id_key" ON "SalesDocumentLine"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocumentLine_companyId_documentId_lineNumber_key" ON "SalesDocumentLine"("companyId", "documentId", "lineNumber");

-- CreateIndex
CREATE INDEX "SalesDocumentEvent_companyId_documentId_createdAt_idx" ON "SalesDocumentEvent"("companyId", "documentId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesDocumentEvent_companyId_eventType_createdAt_idx" ON "SalesDocumentEvent"("companyId", "eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocumentEvent_companyId_id_key" ON "SalesDocumentEvent"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocumentEvent_companyId_idempotencyKey_key" ON "SalesDocumentEvent"("companyId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "SalesNumberSeries" ADD CONSTRAINT "SalesNumberSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_companyId_partyId_fkey" FOREIGN KEY ("companyId", "partyId") REFERENCES "Party"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_companyId_sourceDocumentId_fkey" FOREIGN KEY ("companyId", "sourceDocumentId") REFERENCES "SalesDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_companyId_numberSeriesId_fkey" FOREIGN KEY ("companyId", "numberSeriesId") REFERENCES "SalesNumberSeries"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_companyId_paymentLedgerId_fkey" FOREIGN KEY ("companyId", "paymentLedgerId") REFERENCES "Ledger"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocumentLine" ADD CONSTRAINT "SalesDocumentLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocumentLine" ADD CONSTRAINT "SalesDocumentLine_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "SalesDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocumentLine" ADD CONSTRAINT "SalesDocumentLine_companyId_itemId_fkey" FOREIGN KEY ("companyId", "itemId") REFERENCES "StockItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocumentLine" ADD CONSTRAINT "SalesDocumentLine_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocumentLine" ADD CONSTRAINT "SalesDocumentLine_companyId_sourceLineId_fkey" FOREIGN KEY ("companyId", "sourceLineId") REFERENCES "SalesDocumentLine"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocumentEvent" ADD CONSTRAINT "SalesDocumentEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocumentEvent" ADD CONSTRAINT "SalesDocumentEvent_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "SalesDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocumentEvent" ADD CONSTRAINT "SalesDocumentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_amounts_check" CHECK (
  "subtotal" >= 0 AND "discountAmount" >= 0 AND "freight" >= 0 AND "otherCharges" >= 0
  AND "taxableAmount" >= 0 AND "cgstAmount" >= 0 AND "sgstAmount" >= 0
  AND "utgstAmount" >= 0 AND "igstAmount" >= 0 AND "totalAmount" >= 0 AND "costOfGoodsSold" >= 0
);

ALTER TABLE "SalesDocumentLine" ADD CONSTRAINT "SalesDocumentLine_amounts_check" CHECK (
  "quantity" > 0 AND "unitRate" >= 0 AND "discountPercent" BETWEEN 0 AND 100
  AND "discountAmount" >= 0 AND "taxableAmount" >= 0 AND "gstRate" BETWEEN 0 AND 100
  AND "cgstRate" >= 0 AND "sgstRate" >= 0 AND "utgstRate" >= 0 AND "igstRate" >= 0
  AND "cgstAmount" >= 0 AND "sgstAmount" >= 0 AND "utgstAmount" >= 0 AND "igstAmount" >= 0
  AND "deliveredQuantity" >= 0 AND "invoicedQuantity" >= 0
);

INSERT INTO "Permission" ("id", "resource", "action", "description")
SELECT gen_random_uuid()::text, catalog."resource", catalog."action", catalog."description"
FROM (VALUES
  ('sales', 'read', 'View quotations and sales documents'),
  ('sales', 'create', 'Create quotations and sales documents'),
  ('sales', 'update', 'Update draft sales documents'),
  ('sales', 'issue', 'Issue quotations and sales orders'),
  ('sales', 'post', 'Post deliveries and sales invoices'),
  ('sales', 'cancel', 'Cancel sales documents'),
  ('sales', 'send', 'Send sales documents to customers'),
  ('sales-reports', 'read', 'View sales registers and profitability reports')
) AS catalog("resource", "action", "description")
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role_row."id", permission_row."id"
FROM "Role" AS role_row
CROSS JOIN "Permission" AS permission_row
WHERE role_row."name" = 'Owner' AND role_row."isSystem" = true
  AND permission_row."resource" IN ('sales', 'sales-reports')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
