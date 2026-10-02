import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requireSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { companySchema } from "@/lib/validation/companies";

export async function GET() {
  try {
    const session = await requireSession();
    const memberships = await prisma.membership.findMany({
      where: { userId: session.user.id, status: "ACTIVE" },
      select: {
        companyId: true,
        company: { select: { id: true, name: true, currency: true } },
      },
      orderBy: { company: { name: "asc" } },
    });
    return successResponse({
      activeCompanyId: session.activeCompanyId,
      companies: memberships.map(({ company }) => company),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
    try {
      const session = await requireSession();
      await enforceRateLimit(rateLimitKey("company-create", session.user.id), 5, 60 * 60_000);
      const input = companySchema.parse(await readJson(request));
      const permissions = [
        ["company", "read"],
        ["company", "update"],
        ["members", "read"],
        ["members", "invite"],
        ["roles", "manage"],
        ["audit", "read"],
        ["profile", "manage"],
      ] as const;
      const company = await prisma.$transaction(async (tx) => {
        const existingDefault = await tx.membership.findFirst({
          where: {
            userId: session.user.id,
            status: "ACTIVE",
            isDefault: true,
          },
          select: { id: true },
        });
        const created = await tx.company.create({
          data: {
            name: input.name,
            legalName: input.legalName ?? null,
            gstin: input.gstin || null,
            memberships: {
              create: {
                userId: session.user.id,
                isDefault: existingDefault === null,
              },
            },
            roles: {
              create: {
                name: "Owner",
                description: "Initial company owner role",
                isSystem: true,
              },
            },
          },
          include: { roles: { select: { id: true }, take: 1 } },
        });
        const roleId = created.roles[0]?.id;
        if (!roleId) throw new Error("Company owner role was not created");

        const rolePermissionRows = [];
        for (const [resource, action] of permissions) {
          const permission = await tx.permission.upsert({
            where: { resource_action: { resource, action } },
            create: { resource, action },
            update: {},
          });
          rolePermissionRows.push({ roleId, permissionId: permission.id });
        }
        await tx.rolePermission.createMany({ data: rolePermissionRows });
        const membership = await tx.membership.findUniqueOrThrow({
          where: { userId_companyId: { userId: session.user.id, companyId: created.id } },
          select: { id: true },
        });
        await tx.membershipRole.create({
          data: { membershipId: membership.id, roleId },
        });
        await writeAuditLog(
          {
            companyId: created.id,
            actorId: session.user.id,
            action: "COMPANY_CREATED",
            entityType: "Company",
            entityId: created.id,
            changes: { name: created.name, gstin: created.gstin },
            ipAddress: requestIp(request),
            userAgent: requestUserAgent(request),
          },
          tx,
        );
        return { id: created.id, name: created.name };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return successResponse(company, 201);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return errorResponse(new ConflictError("A company with this GSTIN already exists"));
      }
      return errorResponse(error);
  }
}
