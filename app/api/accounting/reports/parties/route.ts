import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const querySchema = z.object({
  type: z.enum(["CUSTOMER", "SUPPLIER"]),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
  asOf: z.string().date().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("parties", "read");
    await enforceRateLimit(rateLimitKey("party-summary", context.userId), 90, 60_000);
    const url = new URL(request.url);
    const query = querySchema.parse({
      type: url.searchParams.get("type") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      asOf: url.searchParams.get("asOf") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    const where: Prisma.PartyWhereInput = {
      companyId: context.companyId,
      type: query.type,
      ...(query.status ? { isActive: query.status === "ACTIVE" } : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { gstin: { contains: query.search, mode: "insensitive" } },
          { pan: { contains: query.search, mode: "insensitive" } },
        ],
      } : {}),
    };
    const [parties, total] = await Promise.all([
      prisma.party.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { ledger: { select: { id: true, name: true } } },
      }),
      prisma.party.count({ where }),
    ]);
    const ledgerIds = parties.flatMap((party) => party.ledger ? [party.ledger.id] : []);
    const balances = ledgerIds.length
      ? await prisma.voucherLine.groupBy({
          by: ["ledgerId"],
          where: {
            companyId: context.companyId,
            ledgerId: { in: ledgerIds },
            voucher: {
              is: {
                companyId: context.companyId,
                status: { in: ["POSTED", "REVERSED"] },
                ...(query.asOf ? { voucherDate: { lte: new Date(`${query.asOf}T00:00:00.000Z`) } } : {}),
              },
            },
          },
          _sum: { debit: true, credit: true },
        })
      : [];
    const byLedger = new Map(balances.map((row) => [row.ledgerId, row]));
    return successResponse({
      parties: parties.map((party) => {
        const balance = party.ledger ? byLedger.get(party.ledger.id) : undefined;
        const debit = balance?._sum.debit ?? new Prisma.Decimal(0);
        const credit = balance?._sum.credit ?? new Prisma.Decimal(0);
        const net = debit.minus(credit);
        return {
          id: party.id,
          type: party.type,
          name: party.name,
          gstin: party.gstin,
          pan: party.pan,
          state: party.state,
          creditPeriodDays: party.creditPeriodDays,
          creditLimit: party.creditLimit.toString(),
          isActive: party.isActive,
          ledgerId: party.ledger?.id ?? null,
          ledgerName: party.ledger?.name ?? null,
          balanceDebit: net.greaterThan(0) ? net.toString() : "0",
          balanceCredit: net.lessThan(0) ? net.abs().toString() : "0",
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
      asOf: query.asOf ?? null,
      currency: context.company.currency,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
