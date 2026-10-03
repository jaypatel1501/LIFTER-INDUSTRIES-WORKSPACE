-- CreateEnum
CREATE TYPE "PurchaseDocumentType" AS ENUM ('PURCHASE_ORDER', 'RECEIPT_NOTE', 'PURCHASE_INVOICE', 'PURCHASE_RETURN');

-- CreateEnum
CREATE TYPE "PurchaseDocumentStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'PARTIALLY_INVOICED', 'INVOICED', 'POSTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PurchasePaymentMode" AS ENUM ('CASH', 'CREDIT');

-- CreateEnum
CREATE TYPE "PurchaseDocumentEventType" AS ENUM ('CREATED', 'ORDERED', 'RECEIPT_POSTED', 'INVOICE_POSTED', 'RETURN_POSTED', 'CANCELLED', 'REVERSED');

-- CreateTable
CREATE TABLE "PurchaseNumberSeries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" "PurchaseDocumentType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "suffix" TEXT NOT NULL DEFAULT '',
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseNumberSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentType" "PurchaseDocumentType" NOT NULL,
    "status" "PurchaseDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "partyId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "voucherId" TEXT,
    "numberSeriesId" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "dueDate" DATE,
    "supplierInvoiceNumber" TEXT,
    "supplierInvoiceDate" DATE,
    "paymentMode" "PurchasePaymentMode",
    "paymentLedgerId" TEXT,
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

    CONSTRAINT "PurchaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDocumentLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "itemId" TEXT,
    "costCentreId" TEXT,
    "lineNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsnSac" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "receivedQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "invoicedQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unitRate" DECIMAL(18,4) NOT NULL,
    "discountPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL,
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

    CONSTRAINT "PurchaseDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseDocumentEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" "PurchaseDocumentEventType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDocumentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseNumberSeries_companyId_isActive_documentType_idx" ON "PurchaseNumberSeries"("companyId", "isActive", "documentType");
CREATE UNIQUE INDEX "PurchaseNumberSeries_companyId_id_key" ON "PurchaseNumberSeries"("companyId", "id");
CREATE UNIQUE INDEX "PurchaseNumberSeries_companyId_documentType_periodKey_key" ON "PurchaseNumberSeries"("companyId", "documentType", "periodKey");
CREATE INDEX "PurchaseDocument_companyId_documentType_status_documentDate_idx" ON "PurchaseDocument"("companyId", "documentType", "status", "documentDate");
CREATE INDEX "PurchaseDocument_companyId_partyId_documentDate_idx" ON "PurchaseDocument"("companyId", "partyId", "documentDate");
CREATE INDEX "PurchaseDocument_companyId_sourceDocumentId_documentType_idx" ON "PurchaseDocument"("companyId", "sourceDocumentId", "documentType");
CREATE INDEX "PurchaseDocument_companyId_status_dueDate_idx" ON "PurchaseDocument"("companyId", "status", "dueDate");
CREATE UNIQUE INDEX "PurchaseDocument_companyId_id_key" ON "PurchaseDocument"("companyId", "id");
CREATE UNIQUE INDEX "PurchaseDocument_companyId_documentNumber_key" ON "PurchaseDocument"("companyId", "documentNumber");
CREATE UNIQUE INDEX "PurchaseDocument_companyId_idempotencyKey_key" ON "PurchaseDocument"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX "PurchaseDocument_companyId_voucherId_key" ON "PurchaseDocument"("companyId", "voucherId");
CREATE UNIQUE INDEX "PurchaseDocument_companyId_postIdempotencyKey_key" ON "PurchaseDocument"("companyId", "postIdempotencyKey");
CREATE UNIQUE INDEX "PurchaseDocument_companyId_cancelIdempotencyKey_key" ON "PurchaseDocument"("companyId", "cancelIdempotencyKey");
CREATE UNIQUE INDEX "PurchaseDocument_companyId_partyId_supplierInvoiceNumber_key" ON "PurchaseDocument"("companyId", "partyId", "supplierInvoiceNumber");
CREATE INDEX "PurchaseDocumentLine_companyId_itemId_documentId_idx" ON "PurchaseDocumentLine"("companyId", "itemId", "documentId");
CREATE INDEX "PurchaseDocumentLine_companyId_sourceLineId_idx" ON "PurchaseDocumentLine"("companyId", "sourceLineId");
CREATE INDEX "PurchaseDocumentLine_companyId_warehouseId_batchNumber_idx" ON "PurchaseDocumentLine"("companyId", "warehouseId", "batchNumber");
CREATE INDEX "PurchaseDocumentLine_companyId_costCentreId_idx" ON "PurchaseDocumentLine"("companyId", "costCentreId");
CREATE UNIQUE INDEX "PurchaseDocumentLine_companyId_id_key" ON "PurchaseDocumentLine"("companyId", "id");
CREATE UNIQUE INDEX "PurchaseDocumentLine_companyId_documentId_lineNumber_key" ON "PurchaseDocumentLine"("companyId", "documentId", "lineNumber");
CREATE INDEX "PurchaseDocumentEvent_companyId_documentId_createdAt_idx" ON "PurchaseDocumentEvent"("companyId", "documentId", "createdAt");
CREATE INDEX "PurchaseDocumentEvent_companyId_eventType_createdAt_idx" ON "PurchaseDocumentEvent"("companyId", "eventType", "createdAt");
CREATE UNIQUE INDEX "PurchaseDocumentEvent_companyId_id_key" ON "PurchaseDocumentEvent"("companyId", "id");
CREATE UNIQUE INDEX "PurchaseDocumentEvent_companyId_idempotencyKey_key" ON "PurchaseDocumentEvent"("companyId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "PurchaseNumberSeries" ADD CONSTRAINT "PurchaseNumberSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_companyId_partyId_fkey" FOREIGN KEY ("companyId", "partyId") REFERENCES "Party"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_companyId_sourceDocumentId_fkey" FOREIGN KEY ("companyId", "sourceDocumentId") REFERENCES "PurchaseDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_companyId_numberSeriesId_fkey" FOREIGN KEY ("companyId", "numberSeriesId") REFERENCES "PurchaseNumberSeries"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_companyId_paymentLedgerId_fkey" FOREIGN KEY ("companyId", "paymentLedgerId") REFERENCES "Ledger"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocumentLine" ADD CONSTRAINT "PurchaseDocumentLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocumentLine" ADD CONSTRAINT "PurchaseDocumentLine_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "PurchaseDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocumentLine" ADD CONSTRAINT "PurchaseDocumentLine_companyId_itemId_fkey" FOREIGN KEY ("companyId", "itemId") REFERENCES "StockItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocumentLine" ADD CONSTRAINT "PurchaseDocumentLine_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocumentLine" ADD CONSTRAINT "PurchaseDocumentLine_companyId_costCentreId_fkey" FOREIGN KEY ("companyId", "costCentreId") REFERENCES "CostCentre"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocumentLine" ADD CONSTRAINT "PurchaseDocumentLine_companyId_sourceLineId_fkey" FOREIGN KEY ("companyId", "sourceLineId") REFERENCES "PurchaseDocumentLine"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocumentEvent" ADD CONSTRAINT "PurchaseDocumentEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocumentEvent" ADD CONSTRAINT "PurchaseDocumentEvent_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "PurchaseDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDocumentEvent" ADD CONSTRAINT "PurchaseDocumentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_totalAmount_check" CHECK ("totalAmount" > 0);
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_nonnegative_amounts_check" CHECK ("subtotal" >= 0 AND "discountAmount" >= 0 AND "freight" >= 0 AND "otherCharges" >= 0 AND "taxableAmount" >= 0 AND "cgstAmount" >= 0 AND "sgstAmount" >= 0 AND "utgstAmount" >= 0 AND "igstAmount" >= 0);
ALTER TABLE "PurchaseDocumentLine" ADD CONSTRAINT "PurchaseDocumentLine_quantity_check" CHECK ("quantity" > 0 AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity" AND "invoicedQuantity" >= 0 AND "invoicedQuantity" <= "quantity");
ALTER TABLE "PurchaseDocumentLine" ADD CONSTRAINT "PurchaseDocumentLine_rate_check" CHECK ("unitRate" >= 0 AND "discountPercent" >= 0 AND "discountPercent" <= 100 AND "gstRate" >= 0 AND "gstRate" <= 100 AND "cgstRate" >= 0 AND "sgstRate" >= 0 AND "utgstRate" >= 0 AND "igstRate" >= 0);

INSERT INTO "Permission" ("id", "resource", "action", "description")
SELECT gen_random_uuid()::text, catalog."resource", catalog."action", catalog."description"
FROM (VALUES
        ('purchases', 'read', 'View purchase documents and supplier balances'),
        ('purchases', 'create', 'Create purchase orders and invoices'),
        ('purchases', 'issue', 'Issue purchase orders'),
        ('purchases', 'post', 'Post receipts, purchase invoices and returns'),
        ('purchases', 'cancel', 'Cancel or reverse purchase documents'),
        ('purchase-reports', 'read', 'View purchase register and analysis')
) AS catalog("resource", "action", "description")
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role_row."id", permission_row."id"
FROM "Role" AS role_row
CROSS JOIN "Permission" AS permission_row
WHERE role_row."name" = 'Owner' AND role_row."isSystem" = true
    AND permission_row."resource" IN ('purchases', 'purchase-reports')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
