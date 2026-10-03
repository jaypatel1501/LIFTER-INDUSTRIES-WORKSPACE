import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPurchaseDraft, postPurchaseDocument } from "@/lib/purchases/purchase-service";
import { purchaseDocumentCreateSchema } from "@/lib/validation/purchases";

const databaseTest = process.env.RUN_DB_TESTS === "1" ? test : test.skip;

databaseTest("purchase orders are idempotent and remain scoped to their supplier company", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: {
    email: `purchase-${suffix}@example.test`, normalizedEmail: `purchase-${suffix}@example.test`, passwordHash: "not-used-in-this-database-test",
  } });
  const [company, otherCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Purchase ${suffix}`, booksBeginningDate: new Date("2026-04-01T00:00:00.000Z") } }),
    prisma.company.create({ data: { name: `Other purchase ${suffix}` } }),
  ]);
  const supplier = await prisma.party.create({ data: {
    companyId: company.id, type: "SUPPLIER", name: `Supplier ${suffix}`, country: "India",
    creationKey: `purchase-party-${suffix}`, creationHash: "integration-test",
  } });
  const context = { companyId: company.id, userId: user.id };
  const input = purchaseDocumentCreateSchema.parse({ documentType: "PURCHASE_ORDER", partyId: supplier.id,
    documentDate: "2026-04-01", lines: [{ description: "Packaging service", unit: "JOB", quantity: "2", unitRate: "50", gstRate: "18" }] });
  try {
    const key = `purchase-order-${suffix}`;
    const first = await createPurchaseDraft(context, input, key, {});
    const replay = await createPurchaseDraft(context, input, key, {});
    const foreign = await prisma.purchaseDocument.findFirst({ where: { companyId: otherCompany.id, id: first.document.id } });
    const persisted = await prisma.purchaseDocument.findFirst({ where: { companyId: company.id, id: first.document.id }, include: { lines: true } });
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.document.id).toBe(first.document.id);
    expect(foreign).toBeNull();
    expect(persisted?.documentNumber).toContain("PO-");
    expect(persisted?.totalAmount.toString()).toBe("118");
    expect(persisted?.lines).toHaveLength(1);
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.purchaseDocumentEvent.deleteMany({ where: { companyId: company.id } });
      await tx.purchaseDocumentLine.deleteMany({ where: { companyId: company.id } });
      await tx.purchaseDocument.deleteMany({ where: { companyId: company.id } });
      await tx.purchaseNumberSeries.deleteMany({ where: { companyId: company.id } });
      await tx.party.deleteMany({ where: { companyId: company.id } });
      await tx.auditLog.deleteMany({ where: { companyId: company.id } });
      await tx.company.delete({ where: { id: company.id } });
      await tx.company.delete({ where: { id: otherCompany.id } });
      await tx.user.delete({ where: { id: user.id } });
    });
  }
});

databaseTest("credit purchase invoice posting creates GST, supplier bill and balanced ledger transactions atomically", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: {
    email: `purchase-post-${suffix}@example.test`, normalizedEmail: `purchase-post-${suffix}@example.test`, passwordHash: "not-used-in-this-database-test",
  } });
  const company = await prisma.company.create({ data: { name: `Purchase posting ${suffix}`, stateCode: "27", booksBeginningDate: new Date("2026-04-01T00:00:00.000Z") } });
  const supplier = await prisma.party.create({ data: {
    companyId: company.id, type: "SUPPLIER", name: `Supplier ${suffix}`, stateCode: "27", country: "India",
    creationKey: `purchase-post-party-${suffix}`, creationHash: "integration-test",
  } });
  const context = { companyId: company.id, userId: user.id };
  const input = purchaseDocumentCreateSchema.parse({ documentType: "PURCHASE_INVOICE", partyId: supplier.id,
    documentDate: "2026-04-01", supplierInvoiceNumber: `GST-${suffix}`, supplierInvoiceDate: "2026-04-01",
    lines: [{ description: "Consulting service", unit: "JOB", quantity: "1", unitRate: "100", gstRate: "18" }] });
  try {
    const draft = await createPurchaseDraft(context, input, `purchase-draft-${suffix}`, {});
    const key = `purchase-post-${suffix}`;
    const posted = await postPurchaseDocument(context, draft.document.id, { paymentMode: "CREDIT" }, key, {});
    const replay = await postPurchaseDocument(context, draft.document.id, { paymentMode: "CREDIT" }, key, {});
    if (!posted.voucher) throw new Error("Posted purchase invoice did not return its voucher");
    const voucher = await prisma.accountingVoucher.findFirstOrThrow({ where: { id: posted.voucher.id, companyId: company.id }, include: { lines: { include: { billEntries: true, taxDetails: true, transactions: true } } } });
    const taxTransactions = await prisma.taxTransaction.findMany({ where: { companyId: company.id, voucherId: voucher.id } });
    const debit = voucher.lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0));
    const credit = voucher.lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0));
    expect(posted.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(voucher.status).toBe("POSTED");
    expect(debit.equals(credit)).toBe(true);
    expect(voucher.lines.flatMap((line) => line.billEntries)).toHaveLength(1);
    expect(voucher.lines.flatMap((line) => line.taxDetails)).toHaveLength(2);
    expect(taxTransactions).toHaveLength(2);
    expect(voucher.lines.flatMap((line) => line.transactions)).toHaveLength(voucher.lines.length);
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.purchaseDocumentEvent.deleteMany({ where: { companyId: company.id } });
      await tx.purchaseDocumentLine.deleteMany({ where: { companyId: company.id } });
      await tx.purchaseDocument.deleteMany({ where: { companyId: company.id } });
      await tx.purchaseNumberSeries.deleteMany({ where: { companyId: company.id } });
      await tx.billWiseEntry.deleteMany({ where: { companyId: company.id } });
      await tx.voucherTaxDetail.deleteMany({ where: { companyId: company.id } });
      await tx.taxTransaction.deleteMany({ where: { companyId: company.id } });
      await tx.voucherStockDetail.deleteMany({ where: { companyId: company.id } });
      await tx.costAllocation.deleteMany({ where: { companyId: company.id } });
      await tx.ledgerTransaction.deleteMany({ where: { companyId: company.id } });
      await tx.dayBookEntry.deleteMany({ where: { companyId: company.id } });
      await tx.voucherAuditEvent.deleteMany({ where: { companyId: company.id } });
      await tx.auditLog.deleteMany({ where: { companyId: company.id } });
      await tx.voucherLine.deleteMany({ where: { companyId: company.id } });
      await tx.accountingVoucher.deleteMany({ where: { companyId: company.id } });
      await tx.voucherNumberSeries.deleteMany({ where: { companyId: company.id } });
      await tx.ledger.deleteMany({ where: { companyId: company.id } });
      await tx.party.deleteMany({ where: { companyId: company.id } });
      await tx.ledgerGroup.updateMany({ where: { companyId: company.id }, data: { parentId: null } });
      await tx.ledgerGroup.deleteMany({ where: { companyId: company.id } });
      await tx.company.delete({ where: { id: company.id } });
      await tx.user.delete({ where: { id: user.id } });
    });
  }
});
