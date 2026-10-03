import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
  groupId: z.string().min(1).max(64).optional(),
  asOf: z.string().date().optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("vouchers", "read");
    await enforceRateLimit(rateLimitKey("trial-balance", context.userId), 90, 60_000);
    const url = new URL(request.url);
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      groupId: url.searchParams.get("groupId") ?? undefined,
      asOf: url.searchParams.get("asOf") ?? undefined,
    });
    const ledgerWhere: Prisma.LedgerWhereInput = {
      companyId: context.companyId,
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { code: { contains: query.search, mode: "insensitive" } },
        ],
      } : {}),
    };
    const asOfDate = query.asOf ? new Date(`${query.asOf}T00:00:00.000Z`) : undefined;
    const [ledgers, total, balances] = await Promise.all([
      prisma.ledger.findMany({
        where: ledgerWhere,
        orderBy: [{ group: { name: "asc" } }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { group: { select: { id: true, name: true, nature: true } } },
      }),
      prisma.ledger.count({ where: ledgerWhere }),
      prisma.voucherLine.groupBy({
        by: ["ledgerId"],
        where: {
          companyId: context.companyId,
          voucher: {
            is: {
              companyId: context.companyId,
              status: { in: ["POSTED", "REVERSED"] },
              ...(asOfDate ? { voucherDate: { lte: asOfDate } } : {}),
            },
          },
          ledger: { is: ledgerWhere },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const amountByLedger = new Map(balances.map((row) => [
      row.ledgerId,
      {
        debit: row._sum.debit ?? new Prisma.Decimal(0),
        credit: row._sum.credit ?? new Prisma.Decimal(0),
      },
    ]));
    const rows = ledgers.map((ledger) => {
      const balance = amountByLedger.get(ledger.id) ?? { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
      const net = balance.debit.minus(balance.credit);
      return {
        id: ledger.id,
        name: ledger.name,
        code: ledger.code,
        group: ledger.group,
        totalDebit: balance.debit.toString(),
        totalCredit: balance.credit.toString(),
        balanceDebit: net.greaterThan(0) ? net.toString() : "0",
        balanceCredit: net.lessThan(0) ? net.abs().toString() : "0",
      };
    });
    const debitBalance = balances.reduce((totalValue, row) => {
      const debit = row._sum.debit ?? new Prisma.Decimal(0);
      const credit = row._sum.credit ?? new Prisma.Decimal(0);
      return totalValue.plus(debit.minus(credit).greaterThan(0) ? debit.minus(credit) : 0);
    }, new Prisma.Decimal(0));
    const creditBalance = balances.reduce((totalValue, row) => {
      const debit = row._sum.debit ?? new Prisma.Decimal(0);
      const credit = row._sum.credit ?? new Prisma.Decimal(0);
      return totalValue.plus(credit.minus(debit).greaterThan(0) ? credit.minus(debit) : 0);
    }, new Prisma.Decimal(0));
    return successResponse({
      rows,
      totals: { debitBalance: debitBalance.toString(), creditBalance: creditBalance.toString() },
      currency: context.company.currency,
      total,
      page: query.page,
      pageSize: query.pageSize,
      asOf: query.asOf ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
