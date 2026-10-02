import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { financialYearSchema } from "@/lib/validation/companies";
import { z } from "zod";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

const querySchema = z.object({
  status: z.enum(["OPEN", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("financial-years", "read");
    const url = new URL(request.url);
    const query = querySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const where = { companyId: context.companyId, ...(query.status ? { status: query.status } : {}) };
    const [financialYears, total] = await Promise.all([
      prisma.financialYear.findMany({
        where,
        orderBy: { startDate: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.financialYear.count({ where }),
    ]);
    return successResponse({ financialYears, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("financial-years", "manage");
    await enforceRateLimit(rateLimitKey("financial-year-create", context.companyId), 10, 60 * 60_000);
    const input = financialYearSchema.parse(await readJson(request));
    const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
    const endDate = new Date(`${input.endDate}T00:00:00.000Z`);
    const booksBeginningDate = new Date(`${input.booksBeginningDate}T00:00:00.000Z`);
    const created = await prisma.$transaction(async (tx) => {
      const overlaps = await tx.financialYear.findFirst({
        where: {
          companyId: context.companyId,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: { id: true },
      });
      if (overlaps) throw new ConflictError("Financial year dates overlap an existing financial year");
      const financialYear = await tx.financialYear.create({
        data: {
          companyId: context.companyId,
          name: input.name,
          startDate,
          endDate,
          booksBeginningDate,
        },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "FINANCIAL_YEAR_CREATED",
        entityType: "FinancialYear",
        entityId: financialYear.id,
        changes: {
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
          booksBeginningDate: input.booksBeginningDate,
        },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return financialYear;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ financialYear: created }, 201);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return errorResponse(new ConflictError("A financial year already exists for that start date"));
    }
    return errorResponse(error);
  }
}
