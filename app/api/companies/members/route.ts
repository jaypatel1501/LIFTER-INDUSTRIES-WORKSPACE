import bcrypt from "bcryptjs";
import { Prisma, MembershipStatus } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { sendCompanyInvitationEmail, requireEmailConfiguration } from "@/lib/email";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { createOpaqueToken, getLoginUrl, getPasswordResetUrl, hashSecret } from "@/lib/security";
import { memberInviteSchema, pageQuerySchema } from "@/lib/validation/companies";
import { z } from "zod";

const memberQuerySchema = pageQuerySchema.extend({
  status: z.nativeEnum(MembershipStatus).optional(),
  roleId: z.string().cuid().optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("members", "read");
    const url = new URL(request.url);
    const query = memberQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      roleId: url.searchParams.get("roleId") ?? undefined,
    });
    const where: Prisma.MembershipWhereInput = {
      companyId: context.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.roleId ? {
        roles: { some: { roleId: query.roleId, role: { companyId: context.companyId } } },
      } : {}),
      ...(query.search ? {
        user: {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
            { mobile: { contains: query.search, mode: "insensitive" } },
          ],
        },
      } : {}),
    };
    const [members, total] = await Promise.all([
      prisma.membership.findMany({
        where,
        orderBy: [{ status: "asc" }, { user: { name: "asc" } }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true, status: true, isDefault: true, createdAt: true,
          user: { select: { id: true, name: true, email: true, mobile: true } },
          roles: { select: { role: { select: { id: true, name: true } } } },
        },
      }),
      prisma.membership.count({ where }),
    ]);
    const roles = await prisma.role.findMany({
      where: { companyId: context.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return successResponse({
      members: members.map((member) => ({
        ...member,
        roles: member.roles.map(({ role }) => role),
      })),
      roles,
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
    const context = await requirePermission("members", "invite");
    await enforceRateLimit(rateLimitKey("member-invite", context.companyId), 20, 60 * 60_000);
    const input = memberInviteSchema.parse(await readJson(request));
    requireEmailConfiguration();
    const loginUrl = getLoginUrl();
    if (input.roleIds !== undefined) await requirePermission("roles", "manage");
    const roles = input.roleIds !== undefined
      ? input.roleIds.length
        ? await prisma.role.findMany({
          where: { id: { in: input.roleIds }, companyId: context.companyId },
          select: { id: true },
        })
        : []
      : await prisma.role.findMany({
          where: { companyId: context.companyId, name: "Member" },
          select: { id: true },
          take: 1,
        });
    if (input.roleIds?.length && roles.length !== new Set(input.roleIds).size) {
      throw new ValidationError("One or more selected roles do not belong to this company");
    }
    const assignedRoleIds = roles.map(({ id }) => id);
    let requiresPasswordSetup = false;
    let invitationToken: string | null = null;

    const membership = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { normalizedEmail: input.email },
        select: { id: true, name: true, mobile: true },
      });
      if (existingUser && input.mobile) {
        const mobileOwner = await tx.user.findFirst({
          where: { mobile: input.mobile, id: { not: existingUser.id } },
          select: { id: true },
        });
        if (mobileOwner) throw new ConflictError("This mobile number is already in use");
        if (existingUser.mobile && existingUser.mobile !== input.mobile) {
          throw new ConflictError("This user already has a different mobile number");
        }
      }
      let userId = existingUser?.id;
      if (!existingUser) {
        const randomPassword = createOpaqueToken();
        const passwordHash = await bcrypt.hash(randomPassword, 12);
        const user = await tx.user.create({
          data: {
            email: input.email,
            normalizedEmail: input.email,
            name: input.name,
            mobile: input.mobile || null,
            passwordHash,
          },
          select: { id: true },
        });
        userId = user.id;
        requiresPasswordSetup = true;
        invitationToken = createOpaqueToken();
        await tx.passwordResetToken.updateMany({
          where: { userId, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            userId,
            tokenHash: hashSecret(invitationToken),
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
      } else if (existingUser) {
        await tx.user.update({
          where: { id: existingUser.id },
          data: {
            ...(!existingUser.name ? { name: input.name } : {}),
            ...(!existingUser.mobile && input.mobile ? { mobile: input.mobile } : {}),
          },
        });
      }
      if (!userId) throw new Error("Invited user was not created or found");
      const current = await tx.membership.findUnique({
        where: { userId_companyId: { userId, companyId: context.companyId } },
        select: {
          id: true, status: true,
          roles: { select: { roleId: true } },
        },
      });
      if (current?.status === "ACTIVE") {
        throw new ConflictError("This user is already active in the company");
      }
      const updated = current
        ? await tx.membership.update({
            where: { id: current.id },
            data: { status: "INVITED" },
          })
        : await tx.membership.create({
            data: {
              userId,
              companyId: context.companyId,
              status: "INVITED",
              isDefault: false,
            },
          });
      if (input.roleIds !== undefined) {
        await tx.membershipRole.deleteMany({ where: { membershipId: updated.id } });
      }
      const rolesToAssign = input.roleIds !== undefined
        ? assignedRoleIds
        : current
          ? []
          : assignedRoleIds;
      if (rolesToAssign.length) {
        await tx.membershipRole.createMany({
          data: rolesToAssign.map((roleId) => ({ membershipId: updated.id, roleId })),
          skipDuplicates: true,
        });
      }
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "COMPANY_MEMBER_INVITED",
        entityType: "Membership",
        entityId: updated.id,
        changes: {
          email: input.email,
          status: updated.status,
          roleIds: input.roleIds !== undefined
            ? assignedRoleIds
            : current
              ? current.roles.map(({ roleId }) => roleId)
              : assignedRoleIds,
        },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const link = invitationToken
      ? getPasswordResetUrl(invitationToken)
      : loginUrl;
    try {
      await sendCompanyInvitationEmail(input.email, context.company.name, link, requiresPasswordSetup);
    } catch (error) {
      console.error("Company invitation email delivery failed", error instanceof Error ? error.name : "UnknownError");
      throw new AppError(
        "The invitation is saved, but email delivery failed. Use Resend invitation to retry.",
        502,
        "INVITATION_DELIVERY_FAILED",
      );
    }
    return successResponse({ membershipId: membership.id, status: membership.status }, 201);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return errorResponse(new ConflictError("This email or mobile number is already registered"));
    }
    return errorResponse(error);
  }
}
