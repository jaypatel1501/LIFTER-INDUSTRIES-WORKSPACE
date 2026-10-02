import { z } from "zod";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  taxType: z.enum(["CGST", "SGST", "IGST", "CESS", "TDS", "TCS", "OTHER"]).optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("vouchers", "read");
    await enforceRateLimit(rateLimitKey("tax-transactions-read", context.userId), 90, 60_000);
    const url = new URL(request.url);
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      taxType: url.searchParams.get("taxType") ?? undefined,
    });
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationError("Start date must not be after end date");
    }
    const where = {
      companyId: context.companyId,
      ...(query.taxType ? { taxType: query.taxType } : {}),
      ...(query.from || query.to ? {
        transactionDate: {
          ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
          ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
        },
      } : {}),
    };
    const [transactions, total] = await Promise.all([
      prisma.taxTransaction.findMany({
        where,
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          ledger: { select: { id: true, name: true, code: true } },
          voucher: { select: { id: true, voucherNumber: true, type: true, status: true } },
        },
      }),
      prisma.taxTransaction.count({ where }),
    ]);
    return successResponse({
      transactions: transactions.map((transaction) => ({
        ...transaction,
        taxableAmount: transaction.taxableAmount.toString(),
        taxAmount: transaction.taxAmount.toString(),
        rate: transaction.rate.toString(),
        transactionDate: transaction.transactionDate.toISOString().slice(0, 10),
        createdAt: transaction.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
