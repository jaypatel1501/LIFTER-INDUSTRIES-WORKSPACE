import { errorResponse, successResponse } from "@/lib/api-response";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

const historyQuerySchema = z.object({
  type: z.enum(["login", "session"]).default("login"),
  search: z.string().trim().max(120).optional(),
  success: z.enum(["true", "false"]).optional(),
  status: z.enum(["active", "revoked", "expired"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("sessions", "read");
    await enforceRateLimit(rateLimitKey("security-history", context.userId), 120, 60_000);
    const url = new URL(request.url);
    const query = historyQuerySchema.parse({
      type: url.searchParams.get("type") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      success: url.searchParams.get("success") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const userFilter = {
      memberships: {
        some: {
          companyId: context.companyId,
        },
      },
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { email: { contains: query.search, mode: "insensitive" as const } },
        ],
      } : {}),
    };
    if (query.type === "login") {
      const where = {
        user: userFilter,
        ...(query.success ? { success: query.success === "true" } : {}),
      };
      const [entries, total] = await Promise.all([
        prisma.loginHistory.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true, success: true, ipAddress: true, userAgent: true, createdAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
        }),
        prisma.loginHistory.count({ where }),
      ]);
      return successResponse({ entries, total, page: query.page, pageSize: query.pageSize });
    }
    const now = new Date();
    const sessionStatus = query.status === "active"
      ? { revokedAt: null, expiresAt: { gt: now } }
      : query.status === "revoked"
        ? { revokedAt: { not: null } }
        : query.status === "expired"
          ? { revokedAt: null, expiresAt: { lte: now } }
          : {};
    const where = { user: userFilter, ...sessionStatus };
    const [entries, total] = await Promise.all([
      prisma.authSession.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true, ipAddress: true, userAgent: true, createdAt: true,
          expiresAt: true, revokedAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.authSession.count({ where }),
    ]);
    return successResponse({ entries, total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return errorResponse(error);
  }
}
