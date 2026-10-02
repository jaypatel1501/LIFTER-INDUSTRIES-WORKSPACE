import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { AuthorizationError, ConflictError, ValidationError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { memberUpdateSchema } from "@/lib/validation/companies";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  try {
    const context = await requirePermission("members", "read");
    const { membershipId } = await params;
    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, companyId: context.companyId },
      select: {
        id: true, status: true, isDefault: true, createdAt: true, updatedAt: true,
        user: {
          select: {
            id: true, name: true, email: true, mobile: true, locale: true,
            createdAt: true, emailVerifiedAt: true,
          },
        },
        roles: { select: { role: { select: { id: true, name: true, description: true } } } },
      },
    });
    if (!membership) throw new AuthorizationError("Company membership not found");
    return successResponse({
      membership: { ...membership, roles: membership.roles.map(({ role }) => role) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  try {
    const context = await requirePermission("members", "read");
    await enforceRateLimit(rateLimitKey("member-update", context.userId), 60, 60 * 60_000);
    const { membershipId } = await params;
    const input = memberUpdateSchema.parse(await readJson(request));
    if (input.status !== undefined) {
      await requirePermission("members", "update");
      if (membershipId === context.membershipId && input.status !== "ACTIVE") {
        throw new ConflictError("You cannot suspend your own active membership");
      }
    }
    if (input.roleIds !== undefined) await requirePermission("roles", "manage");
    const result = await prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, companyId: context.companyId },
        select: {
          id: true, userId: true, status: true,
          roles: { select: { roleId: true, role: { select: { name: true } } } },
        },
      });
      if (!membership) throw new AuthorizationError("Company membership not found");
      if (input.roleIds !== undefined) {
        const roles = await tx.role.findMany({
          where: { id: { in: input.roleIds }, companyId: context.companyId },
          select: { id: true },
        });
        if (roles.length !== new Set(input.roleIds).size) {
          throw new ValidationError("One or more selected roles do not belong to this company");
        }
        if (
          membership.status === "ACTIVE" &&
          membership.roles.some(({ role }) => role.name === "Owner") &&
          !roles.some(({ id }) => membership.roles.some(
            (existingRole) => existingRole.role.name === "Owner" && existingRole.roleId === id,
          ))
        ) {
          const otherOwnerCount = await tx.membership.count({
            where: {
              companyId: context.companyId,
              status: "ACTIVE",
              id: { not: membershipId },
              roles: { some: { role: { name: "Owner", companyId: context.companyId } } },
            },
          });
          if (otherOwnerCount === 0) {
            throw new ConflictError("The company must retain at least one active owner");
          }
        }
        await tx.membershipRole.deleteMany({ where: { membershipId } });
        if (input.roleIds.length) {
          await tx.membershipRole.createMany({
            data: input.roleIds.map((roleId) => ({ membershipId, roleId })),
          });
        }
      }
      if (input.status !== undefined && input.status !== "ACTIVE" &&
          membership.status === "ACTIVE" &&
          membership.roles.some(({ role }) => role.name === "Owner")) {
        const otherOwnerCount = await tx.membership.count({
          where: {
            companyId: context.companyId,
            status: "ACTIVE",
            id: { not: membershipId },
            roles: { some: { role: { name: "Owner", companyId: context.companyId } } },
          },
        });
        if (otherOwnerCount === 0) {
          throw new ConflictError("The company must retain at least one active owner");
        }
      }
      const updated = await tx.membership.update({
        where: { id: membershipId },
        data: input.status !== undefined ? { status: input.status } : {},
        select: {
          id: true, status: true,
          user: { select: { id: true, name: true, email: true } },
          roles: { select: { role: { select: { id: true, name: true } } } },
        },
      });
      if (input.status !== undefined && input.status !== "ACTIVE") {
        await tx.user.update({
          where: { id: membership.userId },
          data: { sessionVersion: { increment: 1 } },
        });
        await tx.authSession.updateMany({
          where: { userId: membership.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: input.status === undefined ? "COMPANY_MEMBER_ROLES_UPDATED" : "COMPANY_MEMBER_STATUS_UPDATED",
        entityType: "Membership",
        entityId: membershipId,
        changes: {
          ...(input.status !== undefined ? { status: { from: membership.status, to: input.status } } : {}),
          ...(input.roleIds !== undefined
            ? {
                roleIds: {
                  from: membership.roles.map(({ roleId }) => roleId),
                  to: input.roleIds,
                },
              }
            : {}),
        },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return {
        ...updated,
        roles: updated.roles.map(({ role }) => role),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ membership: result });
  } catch (error) {
    return errorResponse(error);
  }
}
