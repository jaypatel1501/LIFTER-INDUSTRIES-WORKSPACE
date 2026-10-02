CREATE TYPE "InventoryMovementType" AS ENUM (
  'OPENING', 'PURCHASE', 'SALES', 'SALES_RETURN', 'PURCHASE_RETURN',
  'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'PRODUCTION_IN',
  'PRODUCTION_OUT', 'JOB_WORK_IN', 'JOB_WORK_OUT'
);
CREATE TYPE "InventoryDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "StockGroup" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UnitOfMeasure" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "precision" INTEGER NOT NULL DEFAULT 3,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UnitOfMeasure_precision_check" CHECK ("precision" BETWEEN 0 AND 6)
);

CREATE TABLE "UnitConversion" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fromUnitId" TEXT NOT NULL,
  "toUnitId" TEXT NOT NULL,
  "factor" DECIMAL(18,8) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnitConversion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UnitConversion_factor_check" CHECK ("factor" > 0),
  CONSTRAINT "UnitConversion_distinct_units_check" CHECK ("fromUnitId" <> "toUnitId")
);

CREATE TABLE "StockItem" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "baseUnitId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "hsnSac" TEXT,
  "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "purchaseRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "salesRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "mrp" DECIMAL(18,4),
  "reorderLevel" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "minimumLevel" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "maximumLevel" DECIMAL(18,6),
  "batchTracked" BOOLEAN NOT NULL DEFAULT false,
  "barcode" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "creationKey" TEXT NOT NULL,
  "creationHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockItem_gstRate_check" CHECK ("gstRate" BETWEEN 0 AND 100),
  CONSTRAINT "StockItem_purchaseRate_check" CHECK ("purchaseRate" >= 0),
  CONSTRAINT "StockItem_salesRate_check" CHECK ("salesRate" >= 0),
  CONSTRAINT "StockItem_mrp_check" CHECK ("mrp" IS NULL OR "mrp" >= 0),
  CONSTRAINT "StockItem_minimumLevel_check" CHECK ("minimumLevel" >= 0),
  CONSTRAINT "StockItem_reorderLevel_check" CHECK ("reorderLevel" >= "minimumLevel"),
  CONSTRAINT "StockItem_maximumLevel_check" CHECK ("maximumLevel" IS NULL OR "maximumLevel" >= "reorderLevel"),
  CONSTRAINT "StockItem_hsnSac_format_check" CHECK ("hsnSac" IS NULL OR "hsnSac" ~ '^[A-Z0-9]{4,8}$')
);

CREATE TABLE "ItemUnitConversion" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "baseQuantity" DECIMAL(18,8) NOT NULL,
  "barcode" TEXT,
  CONSTRAINT "ItemUnitConversion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ItemUnitConversion_baseQuantity_check" CHECK ("baseQuantity" > 0)
);

CREATE TABLE "Warehouse" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "address" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryBatch" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL,
  "manufacturingDate" DATE,
  "expiryDate" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryBatch_dates_check" CHECK ("manufacturingDate" IS NULL OR "expiryDate" IS NULL OR "manufacturingDate" <= "expiryDate")
);

CREATE TABLE "StockBalance" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "batchId" TEXT,
  "locationKey" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockBalance_nonnegative_check" CHECK ("quantity" >= 0 AND "value" >= 0)
);

CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "batchId" TEXT,
  "voucherId" TEXT,
  "movementType" "InventoryMovementType" NOT NULL,
  "direction" "InventoryDirection" NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "unitCost" DECIMAL(18,4) NOT NULL,
  "value" DECIMAL(18,4) NOT NULL,
  "movementDate" DATE NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_amounts_check" CHECK ("quantity" > 0 AND "unitCost" >= 0 AND "value" >= 0)
);

CREATE UNIQUE INDEX "StockGroup_companyId_id_key" ON "StockGroup"("companyId", "id");
CREATE UNIQUE INDEX "StockGroup_companyId_name_key" ON "StockGroup"("companyId", "name");
CREATE UNIQUE INDEX "StockGroup_companyId_code_key" ON "StockGroup"("companyId", "code");
CREATE INDEX "StockGroup_companyId_parentId_idx" ON "StockGroup"("companyId", "parentId");

CREATE UNIQUE INDEX "UnitOfMeasure_companyId_id_key" ON "UnitOfMeasure"("companyId", "id");
CREATE UNIQUE INDEX "UnitOfMeasure_companyId_name_key" ON "UnitOfMeasure"("companyId", "name");
CREATE UNIQUE INDEX "UnitOfMeasure_companyId_symbol_key" ON "UnitOfMeasure"("companyId", "symbol");
CREATE INDEX "UnitOfMeasure_companyId_name_idx" ON "UnitOfMeasure"("companyId", "name");

CREATE UNIQUE INDEX "UnitConversion_companyId_fromUnitId_toUnitId_key" ON "UnitConversion"("companyId", "fromUnitId", "toUnitId");
CREATE INDEX "UnitConversion_companyId_toUnitId_idx" ON "UnitConversion"("companyId", "toUnitId");

CREATE UNIQUE INDEX "StockItem_companyId_id_key" ON "StockItem"("companyId", "id");
CREATE UNIQUE INDEX "StockItem_companyId_name_key" ON "StockItem"("companyId", "name");
CREATE UNIQUE INDEX "StockItem_companyId_code_key" ON "StockItem"("companyId", "code");
CREATE UNIQUE INDEX "StockItem_companyId_barcode_key" ON "StockItem"("companyId", "barcode");
CREATE UNIQUE INDEX "StockItem_companyId_creationKey_key" ON "StockItem"("companyId", "creationKey");
CREATE INDEX "StockItem_companyId_groupId_isActive_name_idx" ON "StockItem"("companyId", "groupId", "isActive", "name");
CREATE INDEX "StockItem_companyId_baseUnitId_idx" ON "StockItem"("companyId", "baseUnitId");
CREATE INDEX "StockItem_companyId_hsnSac_idx" ON "StockItem"("companyId", "hsnSac");
CREATE INDEX "StockItem_companyId_batchTracked_isActive_idx" ON "StockItem"("companyId", "batchTracked", "isActive");

CREATE UNIQUE INDEX "ItemUnitConversion_companyId_itemId_unitId_key" ON "ItemUnitConversion"("companyId", "itemId", "unitId");
CREATE UNIQUE INDEX "ItemUnitConversion_companyId_barcode_key" ON "ItemUnitConversion"("companyId", "barcode");
CREATE INDEX "ItemUnitConversion_companyId_unitId_idx" ON "ItemUnitConversion"("companyId", "unitId");

CREATE UNIQUE INDEX "Warehouse_companyId_id_key" ON "Warehouse"("companyId", "id");
CREATE UNIQUE INDEX "Warehouse_companyId_name_key" ON "Warehouse"("companyId", "name");
CREATE UNIQUE INDEX "Warehouse_companyId_code_key" ON "Warehouse"("companyId", "code");
CREATE INDEX "Warehouse_companyId_parentId_isActive_idx" ON "Warehouse"("companyId", "parentId", "isActive");

CREATE UNIQUE INDEX "InventoryBatch_companyId_id_key" ON "InventoryBatch"("companyId", "id");
CREATE UNIQUE INDEX "InventoryBatch_companyId_itemId_warehouseId_batchNumber_key" ON "InventoryBatch"("companyId", "itemId", "warehouseId", "batchNumber");
CREATE INDEX "InventoryBatch_companyId_itemId_expiryDate_idx" ON "InventoryBatch"("companyId", "itemId", "expiryDate");
CREATE INDEX "InventoryBatch_companyId_warehouseId_expiryDate_idx" ON "InventoryBatch"("companyId", "warehouseId", "expiryDate");

CREATE UNIQUE INDEX "StockBalance_companyId_itemId_warehouseId_locationKey_key" ON "StockBalance"("companyId", "itemId", "warehouseId", "locationKey");
CREATE INDEX "StockBalance_companyId_warehouseId_itemId_idx" ON "StockBalance"("companyId", "warehouseId", "itemId");
CREATE INDEX "StockBalance_companyId_itemId_quantity_idx" ON "StockBalance"("companyId", "itemId", "quantity");

CREATE UNIQUE INDEX "InventoryMovement_companyId_idempotencyKey_key" ON "InventoryMovement"("companyId", "idempotencyKey");
CREATE INDEX "InventoryMovement_companyId_itemId_movementDate_id_idx" ON "InventoryMovement"("companyId", "itemId", "movementDate", "id");
CREATE INDEX "InventoryMovement_companyId_warehouseId_movementDate_idx" ON "InventoryMovement"("companyId", "warehouseId", "movementDate");
CREATE INDEX "InventoryMovement_companyId_batchId_movementDate_idx" ON "InventoryMovement"("companyId", "batchId", "movementDate");
CREATE INDEX "InventoryMovement_companyId_voucherId_idx" ON "InventoryMovement"("companyId", "voucherId");

ALTER TABLE "StockGroup" ADD CONSTRAINT "StockGroup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockGroup" ADD CONSTRAINT "StockGroup_companyId_parentId_fkey" FOREIGN KEY ("companyId", "parentId") REFERENCES "StockGroup"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnitOfMeasure" ADD CONSTRAINT "UnitOfMeasure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_companyId_fromUnitId_fkey" FOREIGN KEY ("companyId", "fromUnitId") REFERENCES "UnitOfMeasure"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_companyId_toUnitId_fkey" FOREIGN KEY ("companyId", "toUnitId") REFERENCES "UnitOfMeasure"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_companyId_groupId_fkey" FOREIGN KEY ("companyId", "groupId") REFERENCES "StockGroup"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_companyId_baseUnitId_fkey" FOREIGN KEY ("companyId", "baseUnitId") REFERENCES "UnitOfMeasure"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_companyId_itemId_fkey" FOREIGN KEY ("companyId", "itemId") REFERENCES "StockItem"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_companyId_unitId_fkey" FOREIGN KEY ("companyId", "unitId") REFERENCES "UnitOfMeasure"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_companyId_parentId_fkey" FOREIGN KEY ("companyId", "parentId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_companyId_itemId_fkey" FOREIGN KEY ("companyId", "itemId") REFERENCES "StockItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_companyId_itemId_fkey" FOREIGN KEY ("companyId", "itemId") REFERENCES "StockItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_companyId_batchId_fkey" FOREIGN KEY ("companyId", "batchId") REFERENCES "InventoryBatch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_companyId_itemId_fkey" FOREIGN KEY ("companyId", "itemId") REFERENCES "StockItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "Warehouse"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_companyId_batchId_fkey" FOREIGN KEY ("companyId", "batchId") REFERENCES "InventoryBatch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "AccountingVoucher"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "resource", "action", "description")
SELECT gen_random_uuid()::text, catalog."resource", catalog."action", catalog."description"
FROM (VALUES
  ('inventory', 'read', 'View stock items and inventory reports'),
  ('inventory', 'create', 'Create stock items and opening stock'),
  ('inventory', 'update', 'Update stock item settings'),
  ('stock-groups', 'read', 'View stock groups'),
  ('stock-groups', 'manage', 'Manage stock groups'),
  ('units', 'read', 'View units and conversions'),
  ('units', 'manage', 'Manage units and conversions'),
  ('warehouses', 'read', 'View warehouses and godowns'),
  ('warehouses', 'manage', 'Manage warehouses and godowns'),
  ('inventory-movements', 'read', 'View inventory movement history')
) AS catalog("resource", "action", "description")
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r CROSS JOIN "Permission" AS p
WHERE r."name" = 'Owner' AND r."isSystem" = true
  AND p."resource" IN ('inventory', 'stock-groups', 'units', 'warehouses', 'inventory-movements')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "Ledger" ("id", "companyId", "groupId", "name", "code", "type", "isSystem", "creationKey", "creationHash", "createdAt", "updatedAt")
SELECT
  'l' || md5(company."id" || ':STOCK_ON_HAND'),
  company."id",
  group_row."id",
  'Stock on Hand',
  'STOCK_ON_HAND',
  'GENERAL',
  true,
  'system:stock-on-hand',
  'system',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" AS company
JOIN "LedgerGroup" AS group_row
  ON group_row."companyId" = company."id" AND group_row."code" = 'STOCK_IN_HAND'
ON CONFLICT ("companyId", "code") DO NOTHING;

WITH groups("code", "name", "parentCode") AS (
  VALUES
    ('GENERAL', 'General Stock', NULL::TEXT),
    ('RAW_MATERIALS', 'Raw Materials', 'GENERAL'),
    ('FINISHED_GOODS', 'Finished Goods', 'GENERAL'),
    ('PACKING_MATERIALS', 'Packing Materials', 'GENERAL'),
    ('CONSUMABLES', 'Consumables', 'GENERAL'),
    ('SERVICES', 'Services', 'GENERAL')
)
INSERT INTO "StockGroup" ("id", "companyId", "parentId", "name", "code", "isSystem", "createdAt", "updatedAt")
SELECT
  'sg' || md5(company."id" || ':' || groups."code"),
  company."id",
  CASE WHEN groups."parentCode" IS NULL THEN NULL
       ELSE 'sg' || md5(company."id" || ':' || groups."parentCode") END,
  groups."name",
  groups."code",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" AS company CROSS JOIN groups
ON CONFLICT ("companyId", "code") DO NOTHING;

WITH units("name", "symbol", "precision") AS (
  VALUES
    ('Pieces', 'pcs', 0),
    ('Kilogram', 'kg', 3),
    ('Gram', 'g', 3),
    ('Litre', 'L', 3),
    ('Millilitre', 'mL', 3),
    ('Metre', 'm', 3),
    ('Centimetre', 'cm', 3),
    ('Box', 'box', 0),
    ('Hour', 'hr', 2)
)
INSERT INTO "UnitOfMeasure" ("id", "companyId", "name", "symbol", "precision", "isSystem", "createdAt", "updatedAt")
SELECT 'u' || md5(company."id" || ':' || units."symbol"), company."id", units."name", units."symbol", units."precision", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company" AS company CROSS JOIN units
ON CONFLICT ("companyId", "symbol") DO NOTHING;

INSERT INTO "Warehouse" ("id", "companyId", "parentId", "name", "code", "isSystem", "createdAt", "updatedAt")
SELECT 'w' || md5(company."id" || ':MAIN'), company."id", NULL, 'Main Godown', 'MAIN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company" AS company
ON CONFLICT ("companyId", "code") DO NOTHING;

INSERT INTO "UnitConversion" ("id", "companyId", "fromUnitId", "toUnitId", "factor", "createdAt", "updatedAt")
SELECT
  'uc' || md5(company."id" || ':' || conversion."fromSymbol" || ':' || conversion."toSymbol"),
  company."id",
  source_unit."id",
  target_unit."id",
  conversion."factor"::DECIMAL(18,8),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" AS company
CROSS JOIN (VALUES ('kg', 'g', '1000'), ('L', 'mL', '1000'), ('m', 'cm', '100')) AS conversion("fromSymbol", "toSymbol", "factor")
JOIN "UnitOfMeasure" AS source_unit ON source_unit."companyId" = company."id" AND source_unit."symbol" = conversion."fromSymbol"
JOIN "UnitOfMeasure" AS target_unit ON target_unit."companyId" = company."id" AND target_unit."symbol" = conversion."toSymbol"
ON CONFLICT ("companyId", "fromUnitId", "toUnitId") DO NOTHING;
