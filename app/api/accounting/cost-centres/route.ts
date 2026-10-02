import { Prisma } from "@prisma/client";
import { z } from "zod";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
});
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("vouchers", "read");
    const url = new URL(request.url);
    const query = listSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    const where = {
      companyId: context.companyId,
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { code: { contains: query.search, mode: "insensitive" as const } },
        ],
      } : {}),
    };
    const [costCentres, total] = await Promise.all([
      prisma.costCentre.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.costCentre.count({ where }),
    ]);
    return successResponse({ costCentres, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("cost-centres", "manage");
    await enforceRateLimit(rateLimitKey("cost-centre-write", context.userId), 20, 60_000);
    const input = createSchema.parse(await readJson(request));
    const costCentre = await prisma.$transaction(async (tx) => {
      const created = await tx.costCentre.create({
        data: { companyId: context.companyId, name: input.name, code: input.code },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "COST_CENTRE_CREATED",
        entityType: "CostCentre",
        entityId: created.id,
        changes: input,
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return created;
    });
    return successResponse({ costCentre }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A cost centre with this name or code already exists"));
    }
    return errorResponse(error);
  }
}
