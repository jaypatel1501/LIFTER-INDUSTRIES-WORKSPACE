import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { voucherNumberSeriesUpdateSchema } from "@/lib/validation/vouchers";

type RouteContext = { params: Promise<{ seriesId: string }> };

export async function PATCH(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("voucher-series", "manage");
    await enforceRateLimit(rateLimitKey("voucher-series-write", context.userId), 20, 60_000);
    const { seriesId } = await route.params;
    const input = voucherNumberSeriesUpdateSchema.parse(await readJson(request));
    const series = await prisma.$transaction(async (tx) => {
      const current = await tx.voucherNumberSeries.findFirst({
        where: { id: seriesId, companyId: context.companyId },
      });
      if (!current) throw new NotFoundError("Voucher number series not found");
      const data = {
        ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
        ...(input.suffix !== undefined ? { suffix: input.suffix } : {}),
        ...(input.padding !== undefined ? { padding: input.padding } : {}),
        ...(input.requiresApproval !== undefined ? { requiresApproval: input.requiresApproval } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      };
      let updated;
      if (input.nextNumber !== undefined) {
        const changed = await tx.voucherNumberSeries.updateMany({
          where: {
            id: current.id,
            companyId: context.companyId,
            nextNumber: { lte: input.nextNumber },
          },
          data: { ...data, nextNumber: input.nextNumber },
        });
        if (changed.count !== 1) {
          throw new ConflictError("The next number cannot be reduced; doing so could reuse issued voucher numbers");
        }
        updated = await tx.voucherNumberSeries.findFirstOrThrow({
          where: { id: current.id, companyId: context.companyId },
        });
      } else {
        updated = await tx.voucherNumberSeries.update({
          where: { id: current.id },
          data,
        });
      }
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "VOUCHER_NUMBER_SERIES_UPDATED",
        entityType: "VoucherNumberSeries",
        entityId: current.id,
        changes: { before: current, after: input },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return updated;
    });
    return successResponse({ series });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Updated voucher series conflicts with an existing series"));
    }
    return errorResponse(error);
  }
}
