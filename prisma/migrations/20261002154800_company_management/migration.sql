-- CreateEnum
CREATE TYPE "FinancialYearStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Company"
ADD COLUMN "pan" TEXT,
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "stateCode" TEXT,
ADD COLUMN "postalCode" TEXT,
ADD COLUMN "country" TEXT NOT NULL DEFAULT 'India',
ADD COLUMN "email" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "website" TEXT,
ADD COLUMN "logoUrl" TEXT,
ADD COLUMN "booksBeginningDate" DATE,
ADD COLUMN "financialYearStartMonth" INTEGER NOT NULL DEFAULT 4;

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "booksBeginningDate" DATE NOT NULL,
    "status" "FinancialYearStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialYear_pkey" PRIMARY KEY ("id")
);

-- Backfill the management permission catalog and keep existing company owners capable of administration.
INSERT INTO "Permission" ("id", "resource", "action", "description")
SELECT gen_random_uuid()::text, catalog."resource", catalog."action", catalog."description"
FROM (VALUES
    ('company', 'read', 'View company settings'),
    ('company', 'update', 'Edit company settings'),
    ('members', 'read', 'View company users'),
    ('members', 'invite', 'Invite company users'),
    ('members', 'update', 'Activate, suspend and assign users'),
    ('roles', 'read', 'View user groups and permissions'),
    ('roles', 'manage', 'Manage user groups and permissions'),
    ('sessions', 'read', 'View login and session history'),
    ('sessions', 'revoke', 'Revoke company user sessions'),
    ('audit', 'read', 'View audit trail'),
    ('financial-years', 'read', 'View financial years'),
    ('financial-years', 'manage', 'Create financial years'),
    ('financial-years', 'close', 'Close financial years'),
    ('profile', 'manage', 'Manage personal preferences')
) AS catalog("resource", "action", "description")
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r
CROSS JOIN "Permission" AS p
WHERE r."name" = 'Owner' AND r."isSystem" = true
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "Role" ("id", "companyId", "name", "description", "isSystem", "createdAt", "updatedAt")
SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), c."id", 'Member',
       'Standard company member', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company" AS c
WHERE NOT EXISTS (
    SELECT 1 FROM "Role" AS existing_role
    WHERE existing_role."companyId" = c."id" AND existing_role."name" = 'Member'
)
ON CONFLICT ("companyId", "name") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" AS r
JOIN "Permission" AS p
  ON p."resource" = 'company' AND p."action" = 'read'
WHERE r."name" = 'Member' AND r."isSystem" = true
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- CreateIndex
CREATE INDEX "Company_pan_idx" ON "Company"("pan");

-- CreateIndex
CREATE INDEX "Company_stateCode_idx" ON "Company"("stateCode");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_companyId_startDate_key" ON "FinancialYear"("companyId", "startDate");

-- CreateIndex
CREATE INDEX "FinancialYear_companyId_status_startDate_idx" ON "FinancialYear"("companyId", "status", "startDate");

-- CreateIndex
CREATE INDEX "FinancialYear_companyId_endDate_idx" ON "FinancialYear"("companyId", "endDate");

-- AddConstraint
ALTER TABLE "Company"
ADD CONSTRAINT "Company_financialYearStartMonth_check"
CHECK ("financialYearStartMonth" BETWEEN 1 AND 12);

-- Add constraints for tax identifiers and GST jurisdiction codes.
ALTER TABLE "Company"
ADD CONSTRAINT "Company_pan_format_check"
CHECK ("pan" IS NULL OR "pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');

ALTER TABLE "Company"
ADD CONSTRAINT "Company_gstin_format_check"
CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

ALTER TABLE "Company"
ADD CONSTRAINT "Company_stateCode_format_check"
CHECK ("stateCode" IS NULL OR "stateCode" ~ '^[0-9]{2}$');

-- AddConstraint
ALTER TABLE "FinancialYear"
ADD CONSTRAINT "FinancialYear_valid_date_range_check"
CHECK ("startDate" <= "booksBeginningDate" AND "booksBeginningDate" <= "endDate" AND "startDate" < "endDate");

-- AddForeignKey
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
