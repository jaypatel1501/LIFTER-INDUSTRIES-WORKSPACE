import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { companyUpdateSchema } from "@/lib/validation/companies";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

export async function GET() {
  try {
    const context = await requirePermission("company", "read");
    const company = await prisma.company.findFirst({
      where: { id: context.companyId },
      select: {
        id: true, name: true, legalName: true, gstin: true, pan: true,
        addressLine1: true, addressLine2: true, city: true, state: true,
        stateCode: true, postalCode: true, country: true, email: true, phone: true,
        website: true, logoUrl: true, booksBeginningDate: true,
        financialYearStartMonth: true, timezone: true, currency: true,
      },
    });
    if (!company) throw new Error("Active company no longer exists");
    return successResponse({ company });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requirePermission("company", "update");
    await enforceRateLimit(rateLimitKey("company-settings", context.userId), 20, 60_000);
    const input = companyUpdateSchema.parse(await readJson(request));
    const company = await prisma.$transaction(async (tx) => {
      const before = await tx.company.findUniqueOrThrow({
        where: { id: context.companyId },
        select: {
          name: true, legalName: true, gstin: true, pan: true,
          addressLine1: true, addressLine2: true, city: true, state: true,
          stateCode: true, postalCode: true, country: true, email: true, phone: true,
          website: true, timezone: true, currency: true,
          financialYearStartMonth: true, booksBeginningDate: true,
        },
      });
      const updated = await tx.company.update({
        where: { id: context.companyId },
        data: {
          name: input.name,
          legalName: input.legalName || null,
          gstin: input.gstin || null,
          pan: input.pan || null,
          addressLine1: input.addressLine1 || null,
          addressLine2: input.addressLine2 || null,
          city: input.city || null,
          state: input.state || null,
          stateCode: input.stateCode || null,
          postalCode: input.postalCode || null,
          country: input.country,
          email: input.email || null,
          phone: input.phone || null,
          website: input.website || null,
          timezone: input.timezone,
          currency: input.currency,
          financialYearStartMonth: input.financialYearStartMonth,
          booksBeginningDate: input.booksBeginningDate
            ? new Date(`${input.booksBeginningDate}T00:00:00.000Z`)
            : null,
        },
        select: {
          id: true, name: true, legalName: true, gstin: true, pan: true,
          addressLine1: true, addressLine2: true, city: true, state: true,
          stateCode: true, postalCode: true, country: true, email: true, phone: true,
          website: true, booksBeginningDate: true, financialYearStartMonth: true,
          timezone: true, currency: true,
        },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "COMPANY_SETTINGS_UPDATED",
        entityType: "Company",
        entityId: context.companyId,
        changes: {
          updatedFields: Object.keys(input),
          before: {
            ...before,
            booksBeginningDate: before.booksBeginningDate?.toISOString() ?? null,
          },
          after: {
            name: input.name,
            legalName: input.legalName || null,
            gstin: input.gstin || null,
            pan: input.pan || null,
            addressLine1: input.addressLine1 || null,
            addressLine2: input.addressLine2 || null,
            city: input.city || null,
            state: input.state || null,
            stateCode: input.stateCode || null,
            postalCode: input.postalCode || null,
            country: input.country,
            email: input.email || null,
            phone: input.phone || null,
            website: input.website || null,
            timezone: input.timezone,
            currency: input.currency,
            financialYearStartMonth: input.financialYearStartMonth,
            booksBeginningDate: input.booksBeginningDate || null,
          },
        },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return successResponse({ company });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return errorResponse(new ConflictError("GSTIN is already registered to another company"));
    }
    return errorResponse(error);
  }
}
