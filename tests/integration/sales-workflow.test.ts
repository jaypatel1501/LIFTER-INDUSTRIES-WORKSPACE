import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSalesDraft } from "@/lib/sales/sales-service";
import { salesDocumentCreateSchema } from "@/lib/validation/sales";

const databaseTest = process.env.RUN_DB_TESTS === "1" ? test : test.skip;

databaseTest("sales drafts snapshot GST and remain idempotent and company-scoped", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `sales-${suffix}@example.test`,
      normalizedEmail: `sales-${suffix}@example.test`,
      passwordHash: "not-used-in-this-database-test",
    },
  });
  const [company, otherCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Sales ${suffix}`, stateCode: "27", booksBeginningDate: new Date("2026-04-01T00:00:00.000Z") } }),
    prisma.company.create({ data: { name: `Other sales ${suffix}` } }),
  ]);
  const party = await prisma.party.create({
    data: {
      companyId: company.id,
      type: "CUSTOMER",
      name: "GST Sales Test Customer",
      stateCode: "27",
      country: "India",
      creationKey: `sales-party-${suffix}`,
      creationHash: "integration-test",
    },
  });
  const context = { companyId: company.id, userId: user.id };

  try {
    const input = salesDocumentCreateSchema.parse({
      documentType: "QUOTATION",
      partyId: party.id,
      documentDate: "2026-04-01",
      lines: [{ description: "Consulting", unit: "HOUR", quantity: "1", unitRate: "100", gstRate: "18" }],
    });
    const key = `sales-draft-${suffix}`;
    const first = await createSalesDraft(context, input, key, {});
    const replay = await createSalesDraft(context, input, key, {});
    const foreign = await prisma.salesDocument.findFirst({
      where: { companyId: otherCompany.id, id: first.document.id },
    });
    const document = await prisma.salesDocument.findFirst({
      where: { companyId: company.id, id: first.document.id },
      include: { lines: true },
    });
    if (!document) throw new Error("Sales draft was not persisted");

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.document.id).toBe(first.document.id);
    expect(foreign).toBeNull();
    expect(document.documentNumber).toContain("QUO");
    expect(document.cgstAmount.toString()).toBe("9");
    expect(document.sgstAmount.toString()).toBe("9");
    expect(document.totalAmount.equals(new Prisma.Decimal(118))).toBe(true);
    expect(document.lines).toHaveLength(1);
    expect(document.lines[0]?.taxableAmount.toString()).toBe("100");
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.salesDocumentEvent.deleteMany({ where: { companyId: company.id } });
      await tx.salesDocumentLine.deleteMany({ where: { companyId: company.id } });
      await tx.salesDocument.deleteMany({ where: { companyId: company.id } });
      await tx.salesNumberSeries.deleteMany({ where: { companyId: company.id } });
      await tx.party.deleteMany({ where: { companyId: company.id } });
      await tx.auditLog.deleteMany({ where: { companyId: company.id } });
      await tx.company.delete({ where: { id: company.id } });
      await tx.company.delete({ where: { id: otherCompany.id } });
      await tx.user.delete({ where: { id: user.id } });
    });
  }
});
