import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().trim().max(120).optional(),
});

type RouteContext = { params: Promise<{ ledgerId: string }> };

export async function GET(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("vouchers", "read");
    await enforceRateLimit(rateLimitKey("ledger-history", context.userId), 120, 60_000);
    const { ledgerId } = await route.params;
    const url = new URL(request.url);
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationError("Start date must not be after end date");
    }
    const ledger = await prisma.ledger.findFirst({
      where: { id: ledgerId, companyId: context.companyId },
      select: {
        id: true, name: true, code: true, type: true, groupId: true, costCentreEnabled: true,
        interestEnabled: true, interestRate: true, isActive: true, isSystem: true, partyId: true,
        group: { select: { name: true } },
      },
    });
    if (!ledger) throw new NotFoundError("Ledger not found");
    const where: Prisma.VoucherLineWhereInput = {
      companyId: context.companyId,
      ledgerId,
      voucher: {
        is: {
          companyId: context.companyId,
          status: { in: ["POSTED", "REVERSED"] },
          ...(query.from || query.to ? {
            voucherDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          } : {}),
          ...(query.search ? {
            OR: [
              { voucherNumber: { contains: query.search, mode: "insensitive" } },
              { narration: { contains: query.search, mode: "insensitive" } },
            ],
          } : {}),
        },
      },
    };
    const [lines, total, aggregate] = await Promise.all([
      prisma.voucherLine.findMany({
        where,
        orderBy: [{ voucher: { voucherDate: "desc" } }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          voucher: { select: { id: true, voucherNumber: true, type: true, status: true, voucherDate: true, narration: true } },
          billDetails: { select: { id: true, referenceNumber: true, dueDate: true, amount: true } },
        },
      }),
      prisma.voucherLine.count({ where }),
      prisma.voucherLine.aggregate({
        where: {
          companyId: context.companyId,
          ledgerId,
          voucher: {
            is: {
              companyId: context.companyId,
              status: { in: ["POSTED", "REVERSED"] },
              ...(query.to ? { voucherDate: { lte: new Date(`${query.to}T00:00:00.000Z`) } } : {}),
            },
          },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);
    return successResponse({
      ledger: { ...ledger, interestRate: ledger.interestRate?.toString() ?? null },
      transactions: lines.map((line) => ({
        ...line,
        debit: line.debit.toString(),
        credit: line.credit.toString(),
        billDetails: line.billDetails.map((bill) => ({ ...bill, amount: bill.amount.toString() })),
      })),
      totalDebit: aggregate._sum.debit?.toString() ?? "0",
      totalCredit: aggregate._sum.credit?.toString() ?? "0",
      balanceDebit: (aggregate._sum.debit ?? new Prisma.Decimal(0))
        .minus(aggregate._sum.credit ?? new Prisma.Decimal(0))
        .greaterThan(0)
        ? (aggregate._sum.debit ?? new Prisma.Decimal(0)).minus(aggregate._sum.credit ?? new Prisma.Decimal(0)).toString()
        : "0",
      balanceCredit: (aggregate._sum.credit ?? new Prisma.Decimal(0))
        .minus(aggregate._sum.debit ?? new Prisma.Decimal(0))
        .greaterThan(0)
        ? (aggregate._sum.credit ?? new Prisma.Decimal(0)).minus(aggregate._sum.debit ?? new Prisma.Decimal(0)).toString()
        : "0",
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
