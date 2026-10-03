import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuditLogs, writeAuditLog } from "@/lib/audit";
import { createPartyWithOpeningBalance } from "@/lib/accounting/opening-balance";
import { partyCreateSchema } from "@/lib/validation/accounting";

const databaseTest = process.env.RUN_DB_TESTS === "1" ? test : test.skip;

databaseTest("company memberships and audit queries remain tenant-scoped", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `tenant-${suffix}@example.test`,
      normalizedEmail: `tenant-${suffix}@example.test`,
      passwordHash: "not-used-in-this-database-test",
    },
  });

  const [companyA, companyB] = await Promise.all([
    prisma.company.create({ data: { name: `Tenant A ${suffix}` } }),
    prisma.company.create({ data: { name: `Tenant B ${suffix}` } }),
  ]);

  try {
    await prisma.membership.create({
      data: { userId: user.id, companyId: companyA.id },
    });
    await prisma.$transaction(async (tx) => {
      await writeAuditLog(
        {
          companyId: companyA.id,
          actorId: user.id,
          action: "TEST_TENANT_EVENT",
          entityType: "Test",
          changes: { tenant: "A" },
        },
        tx,
      );
    });

    const membershipInA = await prisma.membership.findMany({
      where: { userId: user.id, companyId: companyA.id },
    });
    const membershipInB = await prisma.membership.findMany({
      where: { userId: user.id, companyId: companyB.id },
    });
    const auditInA = await getAuditLogs(companyA.id);
    const auditInB = await getAuditLogs(companyB.id);

    expect(membershipInA).toHaveLength(1);
    expect(membershipInB).toHaveLength(0);
    expect(auditInA.map(({ action }) => action)).toContain("TEST_TENANT_EVENT");
    expect(auditInB).toHaveLength(0);
  } finally {
    await prisma.auditLog.deleteMany({
      where: { companyId: { in: [companyA.id, companyB.id] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [companyA.id, companyB.id] } },
    });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

databaseTest("financial years are isolated by company and constrained to their books dates", async () => {
  const suffix = randomUUID();
  const [companyA, companyB] = await Promise.all([
    prisma.company.create({ data: { name: `Fiscal A ${suffix}` } }),
    prisma.company.create({ data: { name: `Fiscal B ${suffix}` } }),
  ]);
  try {
    await prisma.financialYear.create({
      data: {
        companyId: companyA.id,
        name: "FY 2026-27",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2027-03-31T00:00:00.000Z"),
        booksBeginningDate: new Date("2026-04-01T00:00:00.000Z"),
      },
    });

    const yearsA = await prisma.financialYear.findMany({ where: { companyId: companyA.id } });
    const yearsB = await prisma.financialYear.findMany({ where: { companyId: companyB.id } });
    expect(yearsA).toHaveLength(1);
    expect(yearsB).toHaveLength(0);
  } finally {
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } });
  }
});

databaseTest("party opening balances create an idempotent balanced voucher and bill details", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `accounting-${suffix}@example.test`,
      normalizedEmail: `accounting-${suffix}@example.test`,
      passwordHash: "not-used-in-this-database-test",
    },
  });
  const company = await prisma.company.create({
    data: {
      name: `Accounting ${suffix}`,
      booksBeginningDate: new Date("2026-04-01T00:00:00.000Z"),
    },
  });
  const otherCompany = await prisma.company.create({ data: { name: `Other ${suffix}` } });
  const context = { companyId: company.id, userId: user.id };
  const input = partyCreateSchema.parse({
    type: "CUSTOMER",
    name: "Opening Customer",
    gstin: "27AAPFU0939F1ZV",
    openingBalance: {
      amount: "250.00",
      side: "DEBIT",
      date: "2026-04-01",
      bills: [{ referenceNumber: "INV-OPEN-1", dueDate: "2026-04-30", amount: "250.00" }],
    },
  });

  try {
    const created = await createPartyWithOpeningBalance(context, input, `accounting-${suffix}`, {});
    const replay = await createPartyWithOpeningBalance(context, input, `accounting-${suffix}`, {});
    const voucher = await prisma.accountingVoucher.findFirstOrThrow({
      where: { companyId: company.id, type: "OPENING_BALANCE" },
      include: { lines: { include: { billDetails: true } } },
    });
    const debit = voucher.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
    const credit = voucher.lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0));
    const partyInOtherCompany = await prisma.party.findFirst({
      where: { id: created.party.id, companyId: otherCompany.id },
    });

    expect(created.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.party.id).toBe(created.party.id);
    expect(created.party.ledger?.type).toBe("PARTY");
    expect(voucher.lines).toHaveLength(2);
    expect(debit.toString()).toBe(credit.toString());
    expect(voucher.lines.flatMap(({ billDetails }) => billDetails)).toHaveLength(1);
    expect(partyInOtherCompany).toBeNull();
  } finally {
    const tenant = { companyId: company.id };

    await prisma.salesDocumentLine.updateMany({ where: tenant, data: { sourceLineId: null } });
    await prisma.purchaseDocumentLine.updateMany({ where: tenant, data: { sourceLineId: null } });
    await prisma.salesDocument.updateMany({ where: tenant, data: { sourceDocumentId: null } });
    await prisma.purchaseDocument.updateMany({ where: tenant, data: { sourceDocumentId: null } });
    await prisma.accountingVoucher.updateMany({ where: tenant, data: { reversalOfId: null } });
    await prisma.billWiseEntry.updateMany({ where: tenant, data: { settlesEntryId: null } });

    await prisma.salesDocumentEvent.deleteMany({ where: tenant });
    await prisma.purchaseDocumentEvent.deleteMany({ where: tenant });
    await prisma.salesDocumentLine.deleteMany({ where: tenant });
    await prisma.purchaseDocumentLine.deleteMany({ where: tenant });
    await prisma.salesDocument.deleteMany({ where: tenant });
    await prisma.purchaseDocument.deleteMany({ where: tenant });

    await prisma.billWiseEntry.deleteMany({ where: tenant });
    await prisma.billWiseOpening.deleteMany({ where: tenant });
    await prisma.ledgerTransaction.deleteMany({ where: tenant });
    await prisma.taxTransaction.deleteMany({ where: tenant });
    await prisma.voucherTaxDetail.deleteMany({ where: tenant });
    await prisma.costAllocation.deleteMany({ where: tenant });
    await prisma.voucherStockDetail.deleteMany({ where: tenant });
    await prisma.inventoryMovement.deleteMany({ where: tenant });
    await prisma.voucherAttachment.deleteMany({ where: tenant });
    await prisma.voucherApprovalAction.deleteMany({ where: tenant });
    await prisma.voucherAuditEvent.deleteMany({ where: tenant });
    await prisma.dayBookEntry.deleteMany({ where: tenant });
    await prisma.auditLog.deleteMany({ where: tenant });

    await prisma.voucherLine.deleteMany({ where: tenant });
    await prisma.accountingVoucher.deleteMany({ where: tenant });
    await prisma.ledger.deleteMany({ where: tenant });
    await prisma.party.deleteMany({ where: tenant });
    await prisma.ledgerGroup.updateMany({ where: tenant, data: { parentId: null } });
    await prisma.ledgerGroup.deleteMany({ where: tenant });
    await prisma.company.deleteMany({ where: { id: { in: [company.id, otherCompany.id] } } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
