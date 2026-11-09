import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { withTransaction } from "@/lib/transactions";
import { requirePermission } from "@/lib/permissions";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requestIp, requestUserAgent, readJson } from "@/lib/request";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { gstRegistrationSchema } from "@/lib/validation/gst";

export async function GET() {
  try {
    const context = await requirePermission("company", "read");
    const registration = await prisma.gSTRegistration.findUnique({
      where: { companyId: context.companyId },
    });
    return successResponse({ registration });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requirePermission("company", "update");
    await enforceRateLimit(rateLimitKey("gst-registration-write", context.userId), 10, 60_000);
    const input = gstRegistrationSchema.parse(await readJson(request));
    const result = await withTransaction(async (tx) => {
      const before = await tx.gSTRegistration.findUnique({
        where: { companyId: context.companyId },
      });
      const registration = await tx.gSTRegistration.upsert({
        where: { companyId: context.companyId },
        create: {
          companyId: context.companyId,
          gstin: input.gstin,
          legalName: input.legalName,
          tradeName: input.tradeName || null,
          stateCode: input.stateCode,
          registrationType: input.registrationType,
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
          filingFrequency: input.filingFrequency,
          adapterMode: input.adapterMode,
          isActive: input.isActive,
        },
        update: {
          gstin: input.gstin,
          legalName: input.legalName,
          tradeName: input.tradeName || null,
          stateCode: input.stateCode,
          registrationType: input.registrationType,
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
          filingFrequency: input.filingFrequency,
          adapterMode: input.adapterMode,
          isActive: input.isActive,
        },
      });
      await tx.company.update({
        where: { id: context.companyId },
        data: { gstin: input.gstin, legalName: input.legalName, stateCode: input.stateCode },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "GST_REGISTRATION_UPDATED",
        entityType: "GSTRegistration",
        entityId: registration.id,
        changes: {
          before: before ? {
            gstin: before.gstin,
            stateCode: before.stateCode,
            registrationType: before.registrationType,
            adapterMode: before.adapterMode,
          } : null,
          after: {
            gstin: registration.gstin,
            stateCode: registration.stateCode,
            registrationType: registration.registrationType,
            adapterMode: registration.adapterMode,
          },
        },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return registration;
    });
    return successResponse({ registration: result });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      return errorResponse(new ConflictError("GSTIN is already registered to another company"));
    }
    return errorResponse(error);
  }
}
