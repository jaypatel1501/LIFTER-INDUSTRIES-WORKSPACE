import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { hasPermission, requireCompanyContext, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { ledgerGroupCreateSchema } from "@/lib/validation/accounting";

export async function GET() {
  try {
    const context = await requireCompanyContext();
    const canReadGroups = await hasPermission(context, "ledger-groups", "read");
    const canReadLedgers = await hasPermission(context, "ledgers", "read");
    const canCreateLedgers = await hasPermission(context, "ledgers", "create");
    const canUpdateLedgers = await hasPermission(context, "ledgers", "update");
    if (!canReadGroups && !canReadLedgers && !canCreateLedgers && !canUpdateLedgers) throw new AuthorizationError();
    await enforceRateLimit(rateLimitKey("ledger-groups-read", context.userId), 120, 60_000);
    const groups = await prisma.ledgerGroup.findMany({
      where: { companyId: context.companyId },
      orderBy: [{ nature: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { ledgers: true, children: true } },
        parent: { select: { id: true, name: true } },
      },
    });
    return successResponse({ groups });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("ledger-groups", "manage");
    await enforceRateLimit(rateLimitKey("ledger-group-write", context.userId), 30, 60_000);
    const input = ledgerGroupCreateSchema.parse(await readJson(request));
    const group = await prisma.$transaction(async (tx) => {
      const parentId: string | null = input.parentId ?? null;
      if (parentId) {
        const parent = await tx.ledgerGroup.findFirst({
          where: { id: parentId, companyId: context.companyId },
          select: { id: true, nature: true },
        });
        if (!parent) throw new NotFoundError("Parent group not found in the active company");
        if (parent.nature !== input.nature) throw new ValidationError("A group must have the same account nature as its parent");
      }
      const created = await tx.ledgerGroup.create({
        data: { companyId: context.companyId, ...input, parentId },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "LEDGER_GROUP_CREATED",
        entityType: "LedgerGroup",
        entityId: created.id,
        changes: { name: created.name, code: created.code, nature: created.nature, parentId },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse(group, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A ledger group with this name or code already exists"));
    }
    return errorResponse(error);
  }
}
