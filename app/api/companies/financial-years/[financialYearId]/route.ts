import { errorResponse, successResponse } from "@/lib/api-response";
import { AuthorizationError, ConflictError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { z } from "zod";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

const closeSchema = z.object({ status: z.literal("CLOSED") });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ financialYearId: string }> },
) {
  try {
    const context = await requirePermission("financial-years", "close");
    await enforceRateLimit(rateLimitKey("financial-year-close", context.companyId), 20, 60 * 60_000);
    const { financialYearId } = await params;
    const input = closeSchema.parse(await readJson(request));
    const result = await prisma.$transaction(async (tx) => {
      const financialYear = await tx.financialYear.findFirst({
        where: { id: financialYearId, companyId: context.companyId },
      });
      if (!financialYear) throw new AuthorizationError("Financial year not found");
      if (financialYear.status === "CLOSED") {
        throw new ConflictError("This financial year is already closed");
      }
      const closed = await tx.financialYear.updateMany({
        where: { id: financialYear.id, companyId: context.companyId, status: "OPEN" },
        data: { status: input.status },
      });
      if (closed.count !== 1) {
        throw new ConflictError("This financial year was already closed by another request");
      }
      const updated = await tx.financialYear.findUniqueOrThrow({
        where: { id: financialYear.id },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "FINANCIAL_YEAR_CLOSED",
        entityType: "FinancialYear",
        entityId: updated.id,
        changes: { status: { from: financialYear.status, to: updated.status } },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return updated;
    });
    return successResponse({ financialYear: result });
  } catch (error) {
    return errorResponse(error);
  }
}
