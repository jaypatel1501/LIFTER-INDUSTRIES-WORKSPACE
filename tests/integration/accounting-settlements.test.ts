import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureDefaultChart } from "@/lib/accounting/default-chart";
import { listOpenBills } from "@/lib/accounting/outstanding";
import { createVoucherDraft, postVoucher, reversePostedVoucher } from "@/lib/accounting/voucher-platform";
import { voucherDraftSchema } from "@/lib/validation/vouchers";

const databaseTest = process.env.RUN_DB_TESTS === "1" ? test : test.skip;

databaseTest("UPI payment partially settles a supplier bill and reversal restores its outstanding balance", async () => {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: {
    email: `settlement-${suffix}@example.test`, normalizedEmail: `settlement-${suffix}@example.test`, passwordHash: "unused-in-this-database-test",
  } });
  const company = await prisma.company.create({ data: { name: `Settlement ${suffix}`, booksBeginningDate: new Date("2026-04-01T00:00:00.000Z") } });
  const context = { companyId: company.id, userId: user.id };
  try {
    const chart = await prisma.$transaction((tx) => ensureDefaultChart(tx, company.id));
    const supplier = await prisma.party.create({ data: { companyId: company.id, type: "SUPPLIER", name: `Supplier ${suffix}`,
      country: "India", creationKey: `settlement-party-${suffix}`, creationHash: "integration-test" } });
    const supplierLedger = await prisma.ledger.create({ data: { companyId: company.id, groupId: chart.groups.get("SUNDRY_CREDITORS")!,
      partyId: supplier.id, name: supplier.name, type: "PARTY", creationKey: `settlement-ledger-${suffix}`, creationHash: "integration-test" } });
    const expenseLedger = await prisma.ledger.create({ data: { companyId: company.id, groupId: chart.groups.get("DIRECT_EXPENSES")!,
      name: `Expense ${suffix}`, creationKey: `settlement-expense-${suffix}`, creationHash: "integration-test" } });
    const bankLedger = await prisma.ledger.create({ data: { companyId: company.id, groupId: chart.groups.get("BANK_ACCOUNTS")!,
      name: `Bank ${suffix}`, type: "BANK", creationKey: `settlement-bank-${suffix}`, creationHash: "integration-test" } });

    const invoiceInput = voucherDraftSchema.parse({ type: "PURCHASE", voucherDate: "2026-10-02", narration: "Supplier invoice", lines: [
      { ledgerId: expenseLedger.id, debit: "100.00", credit: "0.00" },
      { ledgerId: supplierLedger.id, debit: "0.00", credit: "100.00", bills: [{ referenceType: "NEW", referenceNumber: `SUP-${suffix}`, dueDate: "2026-11-01", amount: "100.00" }] },
    ] });
    const invoiceDraft = await createVoucherDraft(context, invoiceInput, `invoice-${suffix}`, {});
    await postVoucher(context, invoiceDraft.voucher.id, `invoice-post-${suffix}`, {});
    const sourceBill = await prisma.billWiseEntry.findFirstOrThrow({ where: { companyId: company.id, voucherId: invoiceDraft.voucher.id, referenceType: "NEW" } });
    expect(sourceBill.remainingAmount.equals(new Prisma.Decimal("100.00"))).toBe(true);

    const paymentInput = voucherDraftSchema.parse({ type: "PAYMENT", voucherDate: "2026-10-03", paymentMethod: "UPI",
      paymentReference: `UPI-${suffix}`, paymentDate: "2026-10-03", paymentBank: "Test Bank", narration: "Part payment", lines: [
        { ledgerId: supplierLedger.id, debit: "35.00", credit: "0.00", bills: [{ referenceType: "AGAINST_REF", referenceNumber: `SUP-${suffix}`, billEntryId: sourceBill.id, amount: "35.00" }] },
        { ledgerId: bankLedger.id, debit: "0.00", credit: "35.00" },
      ] });
    const paymentDraft = await createVoucherDraft(context, paymentInput, `payment-${suffix}`, {});
    await postVoucher(context, paymentDraft.voucher.id, `payment-post-${suffix}`, {});
    const partiallyPaid = await prisma.billWiseEntry.findUniqueOrThrow({ where: { id: sourceBill.id } });
    const openBills = await listOpenBills(prisma, company.id, { ledgerId: supplierLedger.id, page: 1, pageSize: 25 });
    const instrument = await prisma.accountingVoucher.findUniqueOrThrow({ where: { id: paymentDraft.voucher.id } });
    expect(partiallyPaid.remainingAmount.toString()).toBe("65");
    expect(partiallyPaid.settledAmount.toString()).toBe("35");
    expect(openBills.bills).toHaveLength(1);
    expect(openBills.bills[0]?.remainingAmount).toBe("65");
    expect(instrument.paymentMethod).toBe("UPI");
    expect(instrument.paymentReference).toBe(`UPI-${suffix}`);

    await reversePostedVoucher(context, paymentDraft.voucher.id, "2026-10-04", `reverse-${suffix}`, "Test payment reversal", {});
    const restored = await prisma.billWiseEntry.findUniqueOrThrow({ where: { id: sourceBill.id } });
    expect(restored.remainingAmount.toString()).toBe("100");
    expect(restored.settledAmount.toString()).toBe("0");
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.billWiseEntry.deleteMany({ where: { companyId: company.id, settlesEntryId: { not: null } } });
      await tx.billWiseEntry.deleteMany({ where: { companyId: company.id } });
      await tx.auditLog.deleteMany({ where: { companyId: company.id } });
      await tx.dayBookEntry.deleteMany({ where: { companyId: company.id } });
      await tx.voucherAuditEvent.deleteMany({ where: { companyId: company.id } });
      await tx.ledgerTransaction.deleteMany({ where: { companyId: company.id } });
      await tx.taxTransaction.deleteMany({ where: { companyId: company.id } });
      await tx.costAllocation.deleteMany({ where: { companyId: company.id } });
      await tx.voucherStockDetail.deleteMany({ where: { companyId: company.id } });
      await tx.voucherTaxDetail.deleteMany({ where: { companyId: company.id } });
      await tx.billWiseOpening.deleteMany({ where: { companyId: company.id } });
      await tx.voucherLine.deleteMany({ where: { companyId: company.id } });
      await tx.accountingVoucher.deleteMany({ where: { companyId: company.id, reversalOfId: { not: null } } });
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
