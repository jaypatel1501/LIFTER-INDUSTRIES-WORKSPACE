import { Prisma, type AccountNature } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { ledgerGroupUpdateSchema } from "@/lib/validation/accounting";

type RouteContext = { params: Promise<{ groupId: string }> };

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("ledger-groups", "manage");
    await enforceRateLimit(rateLimitKey("ledger-group-write", context.userId), 30, 60_000);
    const { groupId } = await route.params;
    const input = ledgerGroupUpdateSchema.parse(await readJson(request));
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.ledgerGroup.findFirst({
        where: { id: groupId, companyId: context.companyId },
        select: { id: true, name: true, nature: true, isSystem: true },
      });
      if (!current) throw new NotFoundError("Ledger group not found");
      if (current.isSystem) throw new ConflictError("Standard accounting groups cannot be modified");
      const data: { name?: string; parentId?: string | null } = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.parentId !== undefined) {
        if (input.parentId === current.id) throw new ValidationError("A group cannot be its own parent");
        if (input.parentId) {
          let parentId: string | null = input.parentId;
          const visited = new Set<string>();
          while (parentId) {
            if (parentId === current.id) throw new ValidationError("A group cannot be moved beneath one of its descendants");
            if (visited.has(parentId)) throw new ConflictError("The accounting group hierarchy contains a cycle");
            visited.add(parentId);
            const parent: { id: string; nature: AccountNature; parentId: string | null } | null = await tx.ledgerGroup.findFirst({
              where: { id: parentId, companyId: context.companyId },
              select: { id: true, nature: true, parentId: true },
            });
            if (!parent) throw new NotFoundError("Parent group not found in the active company");
            if (parent.nature !== current.nature) throw new ValidationError("A group must have the same account nature as its parent");
            parentId = parent.parentId;
          }
        }
        data.parentId = input.parentId;
      }
      const group = await tx.ledgerGroup.update({ where: { id: current.id }, data });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "LEDGER_GROUP_UPDATED",
        entityType: "LedgerGroup",
        entityId: group.id,
        changes: { before: { name: current.name }, after: data },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return group;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A ledger group with this name already exists"));
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("ledger-groups", "manage");
    await enforceRateLimit(rateLimitKey("ledger-group-write", context.userId), 30, 60_000);
    const { groupId } = await route.params;
    await prisma.$transaction(async (tx) => {
      const group = await tx.ledgerGroup.findFirst({
        where: { id: groupId, companyId: context.companyId },
        select: { id: true, name: true, isSystem: true, _count: { select: { ledgers: true, children: true } } },
      });
      if (!group) throw new NotFoundError("Ledger group not found");
      if (group.isSystem) throw new ConflictError("Standard accounting groups cannot be deleted");
      if (group._count.ledgers || group._count.children) throw new ConflictError("Move or remove child groups and ledgers before deleting this group");
      await tx.ledgerGroup.delete({ where: { id: group.id } });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "LEDGER_GROUP_DELETED",
        entityType: "LedgerGroup",
        entityId: group.id,
        changes: { name: group.name },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
