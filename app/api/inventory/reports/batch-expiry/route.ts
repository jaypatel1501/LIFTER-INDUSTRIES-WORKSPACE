import { errorResponse, successResponse } from "@/lib/api-response";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  before: z.string().date().optional(),
  warehouseId: z.string().min(1).max(64).optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("inventory", "read");
    await enforceRateLimit(rateLimitKey("inventory-batch-report", context.userId), 90, 60_000);
    const url = new URL(request.url);
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
      warehouseId: url.searchParams.get("warehouseId") ?? undefined,
    });
    const where = {
      companyId: context.companyId,
      item: { is: { batchTracked: true, isActive: true } },
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.before ? {
        batch: { is: { expiryDate: { lte: new Date(`${query.before}T00:00:00.000Z`) } } },
      } : {}),
      quantity: { gt: 0 },
    };
    const [batches, total] = await Promise.all([
      prisma.stockBalance.findMany({
        where: { ...where, batchId: { not: null } },
        orderBy: [{ batch: { expiryDate: "asc" } }, { item: { name: "asc" } }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          item: { select: { id: true, name: true, code: true, hsnSac: true, baseUnit: { select: { symbol: true } } } },
          warehouse: { select: { id: true, name: true, code: true } },
          batch: { select: { id: true, batchNumber: true, manufacturingDate: true, expiryDate: true } },
        },
      }),
      prisma.stockBalance.count({ where: { ...where, batchId: { not: null } } }),
    ]);
    return successResponse({
      batches: batches.map((balance) => ({
        ...balance,
        quantity: balance.quantity.toString(),
        value: balance.value.toString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
