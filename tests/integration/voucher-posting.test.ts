import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createVoucherDraft, postVoucher, reversePostedVoucher } from "@/lib/accounting/voucher-platform";
import { ensureDefaultChart } from "@/lib/accounting/default-chart";
import { voucherDraftSchema } from "@/lib/validation/vouchers";

const databaseTest = process.env.RUN_DB_TESTS === "1" ? test : test.skip;

databaseTest("posting is idempotent and atomically records voucher ledger and Day Book rows", async () => {
  const suffix = randomUUID();
  let companyId: string | undefined;
  let userId: string | undefined;
  try {
    const user = await prisma.user.create({
      data: {
        email: `voucher-${suffix}@example.test`,
        normalizedEmail: `voucher-${suffix}@example.test`,
        passwordHash: "unused-in-this-database-test",
      },
    });
    userId = user.id;
    const company = await prisma.company.create({
      data: { name: `Voucher test ${suffix}`, booksBeginningDate: new Date("2026-04-01T00:00:00.000Z") },
    });
    companyId = company.id;
    const defaults = await prisma.$transaction((tx) => ensureDefaultChart(tx, company.id));
    const [debitLedger, creditLedger] = await Promise.all([
      prisma.ledger.create({
        data: {
          companyId: company.id,
          groupId: defaults.groups.get("INDIRECT_EXPENSES")!,
          name: `Voucher expense ${suffix}`,
          code: `VEX-${suffix.slice(0, 8)}`,
          creationKey: `voucher-expense-${suffix}`,
          creationHash: suffix,
        },
      }),
      prisma.ledger.create({
        data: {
          companyId: company.id,
          groupId: defaults.groups.get("CASH_IN_HAND")!,
          name: `Voucher cash ${suffix}`,
          code: `VCA-${suffix.slice(0, 8)}`,
          type: "CASH",
          creationKey: `voucher-cash-${suffix}`,
          creationHash: suffix,
        },
      }),
    ]);
    const context = { companyId: company.id, userId: user.id };
    const input = voucherDraftSchema.parse({
      type: "JOURNAL",
      voucherDate: "2026-10-02",
      narration: "Voucher posting integration",
      lines: [
        { ledgerId: debitLedger.id, debit: "150.25", credit: "0.00" },
        { ledgerId: creditLedger.id, debit: "0.00", credit: "150.25" },
      ],
    });
    const created = await createVoucherDraft(context, input, `draft-${suffix}`, {});
    const draftReplay = await createVoucherDraft(context, input, `draft-${suffix}`, {});
    const posted = await postVoucher(context, created.voucher.id, `post-${suffix}`, {});
    const postReplay = await postVoucher(context, created.voucher.id, `post-${suffix}`, {});
    const reversed = await reversePostedVoucher(context, created.voucher.id, "2026-10-03", `reverse-${suffix}`, "Integration test reversal", {});
    const reversalReplay = await reversePostedVoucher(context, created.voucher.id, "2026-10-03", `reverse-${suffix}`, "Integration test reversal", {});
    const [transactions, dayBook, voucher, series, postedLines] = await Promise.all([
      prisma.ledgerTransaction.findMany({ where: { companyId: company.id, voucherId: created.voucher.id } }),
      prisma.dayBookEntry.findMany({ where: { companyId: company.id } }),
      prisma.accountingVoucher.findFirst({ where: { companyId: company.id, id: created.voucher.id } }),
      prisma.voucherNumberSeries.findFirst({ where: { companyId: company.id, voucherType: "JOURNAL" } }),
      prisma.voucherLine.findMany({
        where: { companyId: company.id, voucher: { is: { status: { in: ["POSTED", "REVERSED"] } } } },
        select: { ledgerId: true, debit: true, credit: true },
      }),
    ]);

    expect(created.replayed).toBe(false);
    expect(draftReplay.replayed).toBe(true);
    expect(posted.replayed).toBe(false);
    expect(postReplay.replayed).toBe(true);
    expect(reversed.replayed).toBe(false);
    expect(reversalReplay.replayed).toBe(true);
    expect(voucher?.status).toBe("REVERSED");
    expect(transactions).toHaveLength(2);
    expect(dayBook).toHaveLength(4);
    expect(dayBook.map(({ eventType }) => eventType)).toEqual(expect.arrayContaining(["DRAFT_CREATED", "POSTED"]));
    expect(transactions.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0)).toString()).toBe("150.25");
    expect(transactions.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0)).toString()).toBe("150.25");
    const balances = new Map<string, Prisma.Decimal>();
    for (const line of postedLines) {
      const current = balances.get(line.ledgerId) ?? new Prisma.Decimal(0);
      balances.set(line.ledgerId, current.plus(line.debit).minus(line.credit));
    }
    expect([...balances.values()].every((balance) => balance.isZero())).toBe(true);
    expect(series?.nextNumber).toBe(3);
  } finally {
    if (companyId) {
      const cleanupCompanyId = companyId;
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.dayBookEntry.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.voucherAuditEvent.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.voucherApprovalAction.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.voucherAttachment.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.ledgerTransaction.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.taxTransaction.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.billWiseEntry.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.costAllocation.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.voucherStockDetail.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.voucherTaxDetail.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.billWiseOpening.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.voucherLine.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.accountingVoucher.deleteMany({ where: { companyId: cleanupCompanyId, reversalOfId: { not: null } } });
        await tx.accountingVoucher.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.voucherNumberSeries.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.ledger.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.ledgerGroup.updateMany({ where: { companyId: cleanupCompanyId }, data: { parentId: null } });
        await tx.ledgerGroup.deleteMany({ where: { companyId: cleanupCompanyId } });
        await tx.company.delete({ where: { id: cleanupCompanyId } });
      });
    }
    if (userId) await prisma.user.delete({ where: { id: userId } });
  }
});
