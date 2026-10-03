import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  itemId: z.string().min(1).max(64).optional(),
  warehouseId: z.string().min(1).max(64).optional(),
  batchId: z.string().min(1).max(64).optional(),
  type: z.enum(["OPENING", "PURCHASE", "SALES", "SALES_RETURN", "PURCHASE_RETURN", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT", "PRODUCTION_IN", "PRODUCTION_OUT", "JOB_WORK_IN", "JOB_WORK_OUT"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("inventory-movements", "read");
    await enforceRateLimit(rateLimitKey("inventory-movement-read", context.userId), 120, 60_000);
    const url = new URL(request.url);
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      itemId: url.searchParams.get("itemId") ?? undefined,
      warehouseId: url.searchParams.get("warehouseId") ?? undefined,
      batchId: url.searchParams.get("batchId") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    const where: Prisma.InventoryMovementWhereInput = {
      companyId: context.companyId,
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.type ? { movementType: query.type } : {}),
      ...(query.from || query.to ? {
        movementDate: {
          ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
          ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
        },
      } : {}),
    };
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationError("Start date must not be after end date");
    }
    const [movements, total] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where,
        orderBy: [{ movementDate: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          item: { select: { id: true, name: true, code: true, baseUnit: { select: { symbol: true } } } },
          warehouse: { select: { id: true, name: true, code: true } },
          batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          voucher: { select: { id: true, voucherNumber: true, type: true } },
        },
      }),
      prisma.inventoryMovement.count({ where }),
    ]);
    return successResponse({
      movements: movements.map((movement) => ({
        ...movement,
        quantity: movement.quantity.toString(),
        unitCost: movement.unitCost.toString(),
        value: movement.value.toString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
