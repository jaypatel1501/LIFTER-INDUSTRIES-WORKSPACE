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
  type: z.enum(["OPENING_BALANCE", "JOURNAL", "SALES", "PURCHASE", "PAYMENT", "RECEIPT", "CONTRA"]).optional(),
  event: z.enum(["DRAFT_CREATED", "DRAFT_UPDATED", "APPROVAL_REQUESTED", "APPROVED", "REJECTED", "POSTED", "CANCELLED", "REVERSED"]).optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("vouchers", "read");
    await enforceRateLimit(rateLimitKey("day-book-read", context.userId), 90, 60_000);
    const url = new URL(request.url);
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      event: url.searchParams.get("event") ?? undefined,
    });
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationError("Start date must not be after end date");
    }
    const where = {
      companyId: context.companyId,
      ...(query.type ? { voucherType: query.type } : {}),
      ...(query.event ? { eventType: query.event } : {}),
      ...(query.from || query.to ? {
        voucherDate: {
          ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
          ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
        },
      } : {}),
    };
    const [entries, total] = await Promise.all([
      prisma.dayBookEntry.findMany({
        where,
        orderBy: [{ voucherDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true, voucherId: true, eventType: true, voucherType: true, voucherNumber: true,
          voucherDate: true, narration: true, createdAt: true,
        },
      }),
      prisma.dayBookEntry.count({ where }),
    ]);
    return successResponse({
      entries: entries.map((entry) => ({
        ...entry,
        voucherDate: entry.voucherDate.toISOString().slice(0, 10),
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
