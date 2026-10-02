import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { AuthorizationError, ConflictError, ValidationError } from "@/lib/errors";
import { COMPANY_PERMISSION_CATALOG, COMPANY_PERMISSION_KEYS } from "@/lib/company-permissions";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { roleSchema } from "@/lib/validation/companies";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  try {
    const context = await requirePermission("roles", "manage");
    await enforceRateLimit(rateLimitKey("role-update", context.companyId), 60, 60 * 60_000);
    const { roleId } = await params;
    const input = roleSchema.parse(await readJson(request));
    const permissionKeys = [...new Set(input.permissions)];
    if (permissionKeys.some((key) => !COMPANY_PERMISSION_KEYS.has(key))) {
      throw new ValidationError("Unknown permission in role matrix");
    }
    const role = await prisma.$transaction(async (tx) => {
      const existing = await tx.role.findFirst({
        where: { id: roleId, companyId: context.companyId },
        select: {
          id: true,
          name: true,
          isSystem: true,
          permissions: {
            select: { permission: { select: { resource: true, action: true } } },
          },
        },
      });
      if (!existing) throw new AuthorizationError("Company role not found");
      if (existing.isSystem) throw new ConflictError("System groups cannot be edited");
      const updated = await tx.role.update({
        where: { id: existing.id },
        data: { name: input.name, description: input.description || null },
      });
      await tx.rolePermission.deleteMany({ where: { roleId } });
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
        await tx.rolePermission.create({ data: { roleId, permissionId: permission.id } });
      }
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "COMPANY_ROLE_UPDATED",
        entityType: "Role",
        entityId: roleId,
        changes: {
          name: { from: existing.name, to: updated.name },
          permissionKeys: {
            from: existing.permissions.map(({ permission }) => `${permission.resource}:${permission.action}`),
            to: permissionKeys,
          },
        },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ role });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return errorResponse(new ConflictError("A group with this name already exists"));
    }
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  try {
    const context = await requirePermission("roles", "manage");
    await enforceRateLimit(rateLimitKey("role-delete", context.companyId), 30, 60 * 60_000);
    const { roleId } = await params;
    await prisma.$transaction(async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: roleId, companyId: context.companyId },
        select: { id: true, name: true, isSystem: true },
      });
      if (!role) throw new AuthorizationError("Company role not found");
      if (role.isSystem) throw new ConflictError("System groups cannot be deleted");
      const assignments = await tx.membershipRole.count({ where: { roleId } });
      if (assignments > 0) throw new ConflictError("Remove this group from all users before deleting it");
      await tx.role.delete({ where: { id: roleId } });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "COMPANY_ROLE_DELETED",
        entityType: "Role",
        entityId: roleId,
        changes: { name: role.name },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
