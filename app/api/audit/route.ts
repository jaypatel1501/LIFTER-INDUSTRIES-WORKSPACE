import { errorResponse, successResponse } from "@/lib/api-response";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

const querySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  search: z.string().trim().max(120).optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("audit", "read");
    await enforceRateLimit(rateLimitKey("audit-query", context.userId), 120, 60_000);
    const url = new URL(request.url);
    const query = querySchema.parse({
      take: url.searchParams.get("take") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      entityType: url.searchParams.get("entityType") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    const where = {
      companyId: context.companyId,
      ...(query.action ? { action: { contains: query.action, mode: "insensitive" as const } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.search ? {
        OR: [
          { action: { contains: query.search, mode: "insensitive" as const } },
          { entityType: { contains: query.search, mode: "insensitive" as const } },
          { entityId: { contains: query.search, mode: "insensitive" as const } },
          { actor: { is: { email: { contains: query.search, mode: "insensitive" as const } } } },
          { actor: { is: { name: { contains: query.search, mode: "insensitive" as const } } } },
        ],
      } : {}),
    };
    const pageSize = query.cursor ? query.take : query.pageSize;
    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pageSize,
        ...(query.cursor
          ? { skip: 1, cursor: { id: query.cursor } }
          : { skip: (query.page - 1) * pageSize }),
        include: {
          actor: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return successResponse({
      entries,
      nextCursor: entries.at(-1)?.id ?? null,
      total,
      page: query.page,
      pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
