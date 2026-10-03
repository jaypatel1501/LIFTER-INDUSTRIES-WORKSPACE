import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { hasPermission, requireCompanyContext, requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { stockGroupCreateSchema } from "@/lib/validation/inventory";

export async function GET() {
  try {
    const context = await requireCompanyContext();
    const [canReadGroups, canReadItems, canCreateItems] = await Promise.all([
      hasPermission(context, "stock-groups", "read"),
      hasPermission(context, "inventory", "read"),
      hasPermission(context, "inventory", "create"),
    ]);
    if (!canReadGroups && !canReadItems && !canCreateItems) throw new AuthorizationError();
    await enforceRateLimit(rateLimitKey("stock-group-read", context.userId), 120, 60_000);
    const groups = await prisma.stockGroup.findMany({
      where: { companyId: context.companyId },
      orderBy: [{ name: "asc" }],
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { items: true, children: true } },
      },
    });
    return successResponse({ groups });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("stock-groups", "manage");
    await enforceRateLimit(rateLimitKey("stock-group-write", context.userId), 30, 60_000);
    const input = stockGroupCreateSchema.parse(await readJson(request));
    const group = await prisma.$transaction(async (tx) => {
      if (input.parentId) {
        const parent = await tx.stockGroup.findFirst({
          where: { id: input.parentId, companyId: context.companyId },
          select: { id: true },
        });
        if (!parent) throw new NotFoundError("Parent stock group not found in the active company");
      }
      const created = await tx.stockGroup.create({
        data: {
          companyId: context.companyId,
          name: input.name,
          code: input.code,
          parentId: input.parentId ?? null,
          description: input.description || null,
        },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "STOCK_GROUP_CREATED",
        entityType: "StockGroup",
        entityId: created.id,
        changes: { name: created.name, code: created.code, parentId: created.parentId },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ group }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A stock group with this name or code already exists"));
    }
    return errorResponse(error);
  }
}
