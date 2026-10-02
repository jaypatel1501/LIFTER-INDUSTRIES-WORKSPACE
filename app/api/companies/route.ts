import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requireSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { grantPermissionsToRole, OWNER_PERMISSIONS } from "@/lib/company-permissions";
import { companySchema } from "@/lib/validation/companies";
import { ensureDefaultChart } from "@/lib/accounting/default-chart";
import { ensureDefaultInventoryMasters } from "@/lib/inventory/defaults";

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
              create: [
                { name: "Owner", description: "Initial company owner role", isSystem: true },
                { name: "Member", description: "Standard company member", isSystem: true },
              ],
            },
          },
          include: { roles: { select: { id: true, name: true } } },
        });
        await ensureDefaultChart(tx, created.id);
        await ensureDefaultInventoryMasters(tx, created.id);
        const roleId = created.roles.find(({ name }) => name === "Owner")?.id;
        const memberRoleId = created.roles.find(({ name }) => name === "Member")?.id;
        if (!roleId) throw new Error("Company owner role was not created");
        if (!memberRoleId) throw new Error("Company member role was not created");
        await grantPermissionsToRole(tx, roleId, OWNER_PERMISSIONS);
        await grantPermissionsToRole(tx, memberRoleId, [["company", "read"]]);
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
