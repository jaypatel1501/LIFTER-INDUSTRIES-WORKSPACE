import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { stockItemUpdateSchema } from "@/lib/validation/inventory";

type RouteContext = { params: Promise<{ itemId: string }> };

export async function GET(_request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("inventory", "read");
    await enforceRateLimit(rateLimitKey("stock-item-read", context.userId), 120, 60_000);
    const { itemId } = await route.params;
    const item = await prisma.stockItem.findFirst({
      where: { id: itemId, companyId: context.companyId },
      include: {
        group: { select: { id: true, name: true, code: true } },
        baseUnit: { select: { id: true, name: true, symbol: true, precision: true } },
        alternateUnits: { include: { unit: { select: { id: true, name: true, symbol: true, precision: true } } } },
        balances: {
          orderBy: [{ warehouse: { name: "asc" } }, { batch: { expiryDate: "asc" } }],
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
            batch: { select: { id: true, batchNumber: true, manufacturingDate: true, expiryDate: true } },
          },
        },
        batches: { orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }] },
      },
    });
    if (!item) throw new NotFoundError("Stock item not found");
    return successResponse({
      item: {
        ...item,
        gstRate: item.gstRate.toString(),
        purchaseRate: item.purchaseRate.toString(),
        salesRate: item.salesRate.toString(),
        mrp: item.mrp?.toString() ?? null,
        reorderLevel: item.reorderLevel.toString(),
        minimumLevel: item.minimumLevel.toString(),
        maximumLevel: item.maximumLevel?.toString() ?? null,
        alternateUnits: item.alternateUnits.map((conversion) => ({
          ...conversion,
          baseQuantity: conversion.baseQuantity.toString(),
        })),
        balances: item.balances.map((balance) => ({
          ...balance,
          quantity: balance.quantity.toString(),
          value: balance.value.toString(),
        })),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("inventory", "update");
    await enforceRateLimit(rateLimitKey("stock-item-write", context.userId), 40, 60_000);
    const { itemId } = await route.params;
    const input = stockItemUpdateSchema.parse(await readJson(request));
    const item = await prisma.$transaction(async (tx) => {
      const current = await tx.stockItem.findFirst({
        where: { id: itemId, companyId: context.companyId },
        select: {
          id: true, name: true, groupId: true, minimumLevel: true, reorderLevel: true,
          maximumLevel: true, gstRate: true, purchaseRate: true, salesRate: true,
        },
      });
      if (!current) throw new NotFoundError("Stock item not found");
      if (input.groupId) {
        const group = await tx.stockGroup.findFirst({
          where: { id: input.groupId, companyId: context.companyId },
          select: { id: true },
        });
        if (!group) throw new NotFoundError("Stock group not found in the active company");
      }
      const minimum = new Prisma.Decimal(input.minimumLevel ?? current.minimumLevel);
      const reorder = new Prisma.Decimal(input.reorderLevel ?? current.reorderLevel);
      const maximumInput = input.maximumLevel === undefined ? current.maximumLevel : input.maximumLevel;
      const maximum = maximumInput === null ? null : new Prisma.Decimal(maximumInput);
      if (reorder.lessThan(minimum) || (maximum && maximum.lessThan(reorder))) {
        throw new ConflictError("Stock levels must satisfy minimum ≤ reorder ≤ maximum");
      }
      const data: Prisma.StockItemUpdateManyMutationInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
        ...(input.hsnSac !== undefined ? { hsnSac: input.hsnSac || null } : {}),
        ...(input.gstRate !== undefined ? { gstRate: new Prisma.Decimal(input.gstRate) } : {}),
        ...(input.purchaseRate !== undefined ? { purchaseRate: new Prisma.Decimal(input.purchaseRate) } : {}),
        ...(input.salesRate !== undefined ? { salesRate: new Prisma.Decimal(input.salesRate) } : {}),
        ...(input.mrp !== undefined ? { mrp: input.mrp === null ? null : new Prisma.Decimal(input.mrp) } : {}),
        ...(input.reorderLevel !== undefined ? { reorderLevel: new Prisma.Decimal(input.reorderLevel) } : {}),
        ...(input.minimumLevel !== undefined ? { minimumLevel: new Prisma.Decimal(input.minimumLevel) } : {}),
        ...(input.maximumLevel !== undefined ? { maximumLevel: input.maximumLevel === null ? null : new Prisma.Decimal(input.maximumLevel) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      };
      const changed = await tx.stockItem.updateMany({
        where: { id: itemId, companyId: context.companyId },
        data,
      });
      if (changed.count !== 1) throw new NotFoundError("Stock item not found");
      const updated = await tx.stockItem.findUniqueOrThrow({
        where: { id: itemId },
        include: {
          group: { select: { id: true, name: true, code: true } },
          baseUnit: { select: { id: true, name: true, symbol: true, precision: true } },
        },
      });
      await writeAuditLog({
        companyId: context.companyId, actorId: context.userId,
        action: "STOCK_ITEM_UPDATED", entityType: "StockItem", entityId: itemId,
        changes: { before: { name: current.name, groupId: current.groupId }, after: input },
        ipAddress: requestIp(request), userAgent: requestUserAgent(request),
      }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({
      item: {
        ...item,
        gstRate: item.gstRate.toString(),
        purchaseRate: item.purchaseRate.toString(),
        salesRate: item.salesRate.toString(),
        mrp: item.mrp?.toString() ?? null,
        reorderLevel: item.reorderLevel.toString(),
        minimumLevel: item.minimumLevel.toString(),
        maximumLevel: item.maximumLevel?.toString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Another stock item already uses this name"));
    }
    return errorResponse(error);
  }
}
