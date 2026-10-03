import { Prisma } from "@prisma/client";
import { z } from "zod";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";

const updateSchema = z.object({ isActive: z.boolean() });
type RouteContext = { params: Promise<{ costCentreId: string }> };

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("cost-centres", "manage");
    await enforceRateLimit(rateLimitKey("cost-centre-write", context.userId), 20, 60_000);
    const { costCentreId } = await route.params;
    const { isActive } = updateSchema.parse(await readJson(request));
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.costCentre.findFirst({
        where: { id: costCentreId, companyId: context.companyId },
      });
      if (!current) throw new NotFoundError("Cost centre not found in the current company");
      const costCentre = await tx.costCentre.update({ where: { id: current.id }, data: { isActive } });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: isActive ? "COST_CENTRE_ACTIVATED" : "COST_CENTRE_DEACTIVATED",
        entityType: "CostCentre",
        entityId: current.id,
        changes: { before: { isActive: current.isActive }, after: { isActive } },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return costCentre;
    });
    return successResponse({ costCentre: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Cost centre conflicts with an existing record"));
    }
    return errorResponse(error);
  }
}
