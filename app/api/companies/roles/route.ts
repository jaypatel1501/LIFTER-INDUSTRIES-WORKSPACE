import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, ValidationError } from "@/lib/errors";
import { COMPANY_PERMISSION_CATALOG, COMPANY_PERMISSION_KEYS } from "@/lib/company-permissions";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { roleSchema } from "@/lib/validation/companies";
import { z } from "zod";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  type: z.enum(["system", "custom"]).optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("roles", "read");
    const url = new URL(request.url);
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
    });
    const where = {
      companyId: context.companyId,
      ...(query.type ? { isSystem: query.type === "system" } : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" as const } },
          { description: { contains: query.search, mode: "insensitive" as const } },
        ],
      } : {}),
    };
    const [roles, total] = await Promise.all([
      prisma.role.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, name: true, description: true, isSystem: true,
        _count: { select: { memberships: true } },
        permissions: {
          select: { permission: { select: { resource: true, action: true } } },
        },
      },
    }),
      prisma.role.count({ where }),
    ]);
    return successResponse({
      roles: roles.map(({ permissions, ...role }) => ({
        ...role,
        permissionKeys: permissions.map(({ permission }) => `${permission.resource}:${permission.action}`),
      })),
      permissionCatalog: COMPANY_PERMISSION_CATALOG,
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("roles", "manage");
    await enforceRateLimit(rateLimitKey("role-create", context.companyId), 30, 60 * 60_000);
    const input = roleSchema.parse(await readJson(request));
    const permissionKeys = [...new Set(input.permissions)];
    if (permissionKeys.some((key) => !COMPANY_PERMISSION_KEYS.has(key))) {
      throw new ValidationError("Unknown permission in role matrix");
    }
    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          companyId: context.companyId,
          name: input.name,
          description: input.description || null,
        },
      });
      for (const key of permissionKeys) {
        const definition = COMPANY_PERMISSION_CATALOG.find(
          (entry) => `${entry.resource}:${entry.action}` === key,
        );
        if (!definition) throw new ValidationError("Unknown permission in role matrix");
        const { resource, action, label } = definition;
        const permission = await tx.permission.upsert({
          where: { resource_action: { resource, action } },
          create: { resource, action, description: label },
          update: {},
        });
        await tx.rolePermission.create({ data: { roleId: created.id, permissionId: permission.id } });
      }
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "COMPANY_ROLE_CREATED",
        entityType: "Role",
        entityId: created.id,
        changes: { name: created.name, permissionKeys },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ role }, 201);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return errorResponse(new ConflictError("A group with this name already exists"));
    }
    return errorResponse(error);
  }
}
