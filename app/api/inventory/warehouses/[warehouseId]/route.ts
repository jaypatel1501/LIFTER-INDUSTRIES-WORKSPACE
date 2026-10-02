import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { warehouseUpdateSchema } from "@/lib/validation/inventory";

type RouteContext = { params: Promise<{ warehouseId: string }> };

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("warehouses", "manage");
    await enforceRateLimit(rateLimitKey("warehouse-write", context.userId), 30, 60_000);
    const { warehouseId } = await route.params;
    const input = warehouseUpdateSchema.parse(await readJson(request));
    const warehouse = await prisma.$transaction(async (tx) => {
      const current = await tx.warehouse.findFirst({
        where: { id: warehouseId, companyId: context.companyId },
        select: { id: true, name: true, isSystem: true },
      });
      if (!current) throw new NotFoundError("Warehouse not found");
      if (current.isSystem && input.isActive === false) throw new ConflictError("The main warehouse cannot be deactivated");
      if (input.parentId !== undefined && input.parentId) {
        if (input.parentId === warehouseId) throw new ConflictError("A warehouse cannot be its own parent");
        let parentId: string | null = input.parentId;
        const visited = new Set<string>();
        while (parentId) {
          if (parentId === warehouseId) throw new ConflictError("A warehouse cannot be moved beneath one of its descendants");
          if (visited.has(parentId)) throw new ConflictError("The warehouse hierarchy contains a cycle");
          visited.add(parentId);
          const parent: { id: string; parentId: string | null } | null = await tx.warehouse.findFirst({
            where: { id: parentId, companyId: context.companyId },
            select: { id: true, parentId: true },
          });
          if (!parent) throw new NotFoundError("Parent warehouse not found in the active company");
          parentId = parent.parentId;
        }
      }
      const updated = await tx.warehouse.update({
        where: { id: warehouseId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.address !== undefined ? { address: input.address || null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await writeAuditLog({
        companyId: context.companyId, actorId: context.userId,
        action: "WAREHOUSE_UPDATED", entityType: "Warehouse", entityId: warehouseId,
        changes: { before: current, after: input },
        ipAddress: requestIp(request), userAgent: requestUserAgent(request),
      }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ warehouse });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A warehouse with this name already exists"));
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("warehouses", "manage");
    await enforceRateLimit(rateLimitKey("warehouse-write", context.userId), 30, 60_000);
    const { warehouseId } = await route.params;
    await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: warehouseId, companyId: context.companyId },
        select: { id: true, name: true, isSystem: true, _count: { select: { children: true, balances: true, movements: true } } },
      });
      if (!warehouse) throw new NotFoundError("Warehouse not found");
      if (warehouse.isSystem || warehouse._count.children || warehouse._count.balances || warehouse._count.movements) {
        throw new ConflictError("System or in-use warehouses cannot be deleted");
      }
      await tx.warehouse.delete({ where: { id: warehouseId } });
      await writeAuditLog({
        companyId: context.companyId, actorId: context.userId,
        action: "WAREHOUSE_DELETED", entityType: "Warehouse", entityId: warehouseId,
        changes: { name: warehouse.name },
        ipAddress: requestIp(request), userAgent: requestUserAgent(request),
      }, tx);
    });
    return successResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
