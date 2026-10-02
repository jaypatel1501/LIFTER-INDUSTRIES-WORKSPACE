import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { stockGroupUpdateSchema } from "@/lib/validation/inventory";

type RouteContext = { params: Promise<{ groupId: string }> };

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("stock-groups", "manage");
    await enforceRateLimit(rateLimitKey("stock-group-write", context.userId), 30, 60_000);
    const { groupId } = await route.params;
    const input = stockGroupUpdateSchema.parse(await readJson(request));
    const group = await prisma.$transaction(async (tx) => {
      const current = await tx.stockGroup.findFirst({
        where: { id: groupId, companyId: context.companyId },
        select: { id: true, name: true, isSystem: true },
      });
      if (!current) throw new NotFoundError("Stock group not found");
      if (current.isSystem) throw new ConflictError("Standard stock groups cannot be modified");
      if (input.parentId !== undefined && input.parentId) {
        if (input.parentId === groupId) throw new ConflictError("A stock group cannot be its own parent");
        let parentId: string | null = input.parentId;
        const visited = new Set<string>();
        while (parentId) {
          if (parentId === groupId) throw new ConflictError("A stock group cannot be moved beneath one of its descendants");
          if (visited.has(parentId)) throw new ConflictError("The stock-group hierarchy contains a cycle");
          visited.add(parentId);
          const parent: { id: string; parentId: string | null } | null = await tx.stockGroup.findFirst({
            where: { id: parentId, companyId: context.companyId },
            select: { id: true, parentId: true },
          });
          if (!parent) throw new NotFoundError("Parent stock group not found in the active company");
          parentId = parent.parentId;
        }
      }
      const data: { name?: string; parentId?: string | null; description?: string | null } = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
      };
      const updated = await tx.stockGroup.update({ where: { id: groupId }, data });
      await writeAuditLog({
        companyId: context.companyId, actorId: context.userId,
        action: "STOCK_GROUP_UPDATED", entityType: "StockGroup", entityId: groupId,
        changes: { before: current, after: input },
        ipAddress: requestIp(request), userAgent: requestUserAgent(request),
      }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ group });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A stock group with this name already exists"));
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("stock-groups", "manage");
    await enforceRateLimit(rateLimitKey("stock-group-write", context.userId), 30, 60_000);
    const { groupId } = await route.params;
    await prisma.$transaction(async (tx) => {
      const group = await tx.stockGroup.findFirst({
        where: { id: groupId, companyId: context.companyId },
        select: { id: true, name: true, isSystem: true, _count: { select: { items: true, children: true } } },
      });
      if (!group) throw new NotFoundError("Stock group not found");
      if (group.isSystem) throw new ConflictError("Standard stock groups cannot be deleted");
      if (group._count.items || group._count.children) throw new ConflictError("Move stock items and child groups before deleting this group");
      await tx.stockGroup.delete({ where: { id: group.id } });
      await writeAuditLog({
        companyId: context.companyId, actorId: context.userId,
        action: "STOCK_GROUP_DELETED", entityType: "StockGroup", entityId: group.id,
        changes: { name: group.name },
        ipAddress: requestIp(request), userAgent: requestUserAgent(request),
      }, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
