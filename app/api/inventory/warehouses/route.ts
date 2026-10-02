import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { warehouseCreateSchema } from "@/lib/validation/inventory";

export async function GET() {
  try {
    const context = await requirePermission("warehouses", "read");
    await enforceRateLimit(rateLimitKey("warehouse-read", context.userId), 120, 60_000);
    const warehouses = await prisma.warehouse.findMany({
      where: { companyId: context.companyId },
      orderBy: [{ name: "asc" }],
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true, balances: true } },
      },
    });
    return successResponse({ warehouses });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("warehouses", "manage");
    await enforceRateLimit(rateLimitKey("warehouse-write", context.userId), 30, 60_000);
    const input = warehouseCreateSchema.parse(await readJson(request));
    const warehouse = await prisma.$transaction(async (tx) => {
      if (input.parentId) {
        const parent = await tx.warehouse.findFirst({
          where: { id: input.parentId, companyId: context.companyId, isActive: true },
          select: { id: true },
        });
        if (!parent) throw new NotFoundError("Parent warehouse is not active in the current company");
      }
      const created = await tx.warehouse.create({
        data: {
          companyId: context.companyId,
          name: input.name,
          code: input.code,
          parentId: input.parentId ?? null,
          address: input.address || null,
        },
      });
      await writeAuditLog({
        companyId: context.companyId, actorId: context.userId,
        action: "WAREHOUSE_CREATED", entityType: "Warehouse", entityId: created.id,
        changes: { name: created.name, code: created.code, parentId: created.parentId },
        ipAddress: requestIp(request), userAgent: requestUserAgent(request),
      }, tx);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ warehouse }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A warehouse with this name or code already exists"));
    }
    return errorResponse(error);
  }
}
