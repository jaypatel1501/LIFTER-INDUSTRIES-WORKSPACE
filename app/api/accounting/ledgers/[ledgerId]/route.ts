import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { ledgerUpdateSchema } from "@/lib/validation/accounting";

type RouteContext = { params: Promise<{ ledgerId: string }> };

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("ledgers", "update");
    await enforceRateLimit(rateLimitKey("ledger-write", context.userId), 40, 60_000);
    const { ledgerId } = await route.params;
    const input = ledgerUpdateSchema.parse(await readJson(request));
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.ledger.findFirst({
        where: { id: ledgerId, companyId: context.companyId },
        select: { id: true, name: true, isSystem: true, partyId: true, groupId: true, type: true, interestRate: true },
      });
      if (!current) throw new NotFoundError("Ledger not found");
      if (current.isSystem || current.partyId) throw new ConflictError("System and party-linked ledgers must be changed through their owning master");
      if (input.groupId) {
        const group = await tx.ledgerGroup.findFirst({
          where: { id: input.groupId, companyId: context.companyId },
          select: { id: true, nature: true },
        });
        if (!group) throw new NotFoundError("Ledger group not found in the active company");
        if (current.type === "INCOME" && group.nature !== "INCOME") throw new ConflictError("Income ledgers must belong to an income group");
        if (current.type === "EXPENSE" && group.nature !== "EXPENSE") throw new ConflictError("Expense ledgers must belong to an expense group");
        if (["CASH", "BANK"].includes(current.type) && group.nature !== "ASSET") throw new ConflictError("Cash and bank ledgers must belong to an asset group");
      }
      if (input.interestEnabled === true && input.interestRate === undefined && current.interestRate === null) {
        throw new ConflictError("An interest rate is required before enabling interest tracking");
      }
      const data: Prisma.LedgerUpdateManyMutationInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
        ...(input.costCentreEnabled !== undefined ? { costCentreEnabled: input.costCentreEnabled } : {}),
        ...(input.interestEnabled !== undefined ? { interestEnabled: input.interestEnabled } : {}),
        ...(input.interestRate !== undefined
          ? { interestRate: input.interestRate === null ? null : new Prisma.Decimal(input.interestRate) }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      };
      const result = await tx.ledger.updateMany({ where: { id: ledgerId, companyId: context.companyId }, data });
      if (result.count !== 1) throw new NotFoundError("Ledger not found");
      const ledger = await tx.ledger.findUniqueOrThrow({
        where: { id: ledgerId },
        include: { group: { select: { id: true, name: true, code: true } } },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "LEDGER_UPDATED",
        entityType: "Ledger",
        entityId: ledgerId,
        changes: { before: { name: current.name, groupId: current.groupId }, after: input },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return ledger;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ ledger: { ...updated, interestRate: updated.interestRate?.toString() ?? null } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A ledger with this name already exists"));
    }
    return errorResponse(error);
  }
}
