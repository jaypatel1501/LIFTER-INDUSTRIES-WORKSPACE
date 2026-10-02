import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { unitCreateSchema } from "@/lib/validation/inventory";

export async function GET() {
  try {
    const context = await requirePermission("units", "read");
    await enforceRateLimit(rateLimitKey("unit-read", context.userId), 120, 60_000);
    const [units, conversions] = await Promise.all([
      prisma.unitOfMeasure.findMany({
        where: { companyId: context.companyId },
        orderBy: [{ name: "asc" }],
        include: { _count: { select: { itemBaseUnits: true, itemConversions: true } } },
      }),
      prisma.unitConversion.findMany({
        where: { companyId: context.companyId },
        include: {
          fromUnit: { select: { id: true, name: true, symbol: true } },
          toUnit: { select: { id: true, name: true, symbol: true } },
        },
        orderBy: [{ fromUnit: { name: "asc" } }],
      }),
    ]);
    return successResponse({
      units,
      conversions: conversions.map((conversion) => ({ ...conversion, factor: conversion.factor.toString() })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("units", "manage");
    await enforceRateLimit(rateLimitKey("unit-write", context.userId), 30, 60_000);
    const input = unitCreateSchema.parse(await readJson(request));
    const unit = await prisma.$transaction(async (tx) => {
      const created = await tx.unitOfMeasure.create({
        data: { companyId: context.companyId, ...input },
      });
      await writeAuditLog({
        companyId: context.companyId, actorId: context.userId,
        action: "UNIT_CREATED", entityType: "UnitOfMeasure", entityId: created.id,
        changes: input, ipAddress: requestIp(request), userAgent: requestUserAgent(request),
      }, tx);
      return created;
    });
    return successResponse({ unit }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A unit with this name or symbol already exists"));
    }
    return errorResponse(error);
  }
}
