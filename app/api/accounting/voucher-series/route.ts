import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { voucherNumberSeriesSchema } from "@/lib/validation/vouchers";

export async function GET() {
  try {
    const context = await requirePermission("vouchers", "read");
    const [numberSeries, financialYears] = await Promise.all([
      prisma.voucherNumberSeries.findMany({
        where: { companyId: context.companyId },
        include: { financialYear: { select: { id: true, name: true, status: true } } },
        orderBy: [{ voucherType: "asc" }, { periodKey: "asc" }],
      }),
      prisma.financialYear.findMany({
        where: { companyId: context.companyId },
        select: { id: true, name: true, status: true },
        orderBy: { startDate: "desc" },
      }),
    ]);
    return successResponse({ numberSeries, financialYears });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("voucher-series", "manage");
    await enforceRateLimit(rateLimitKey("voucher-series-write", context.userId), 20, 60_000);
    const input = voucherNumberSeriesSchema.parse(await readJson(request));
    const periodKey = input.financialYearId ?? "DEFAULT";
    const series = await prisma.$transaction(async (tx) => {
      if (input.financialYearId) {
        const year = await tx.financialYear.findFirst({
          where: { id: input.financialYearId, companyId: context.companyId },
          select: { id: true },
        });
        if (!year) throw new NotFoundError("Financial year not found in the current company");
      }
      const created = await tx.voucherNumberSeries.create({
        data: {
          companyId: context.companyId,
          voucherType: input.voucherType,
          financialYearId: input.financialYearId ?? null,
          periodKey,
          prefix: input.prefix,
          suffix: input.suffix ?? "",
          nextNumber: input.nextNumber ?? 1,
          padding: input.padding,
          requiresApproval: input.requiresApproval,
          isActive: input.isActive,
        },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "VOUCHER_NUMBER_SERIES_CREATED",
        entityType: "VoucherNumberSeries",
        entityId: created.id,
        changes: input,
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return created;
    });
    return successResponse({ series }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A series already exists for this voucher type and financial year"));
    }
    return errorResponse(error);
  }
}
