import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { unitConversionCreateSchema } from "@/lib/validation/inventory";

export async function POST(request: Request) {
  try {
    const context = await requirePermission("units", "manage");
    await enforceRateLimit(rateLimitKey("unit-conversion-write", context.userId), 30, 60_000);
    const input = unitConversionCreateSchema.parse(await readJson(request));
    const conversion = await prisma.$transaction(async (tx) => {
      const [from, to] = await Promise.all([
        tx.unitOfMeasure.findFirst({ where: { id: input.fromUnitId, companyId: context.companyId }, select: { id: true } }),
        tx.unitOfMeasure.findFirst({ where: { id: input.toUnitId, companyId: context.companyId }, select: { id: true } }),
      ]);
      if (!from || !to) throw new NotFoundError("Both units must belong to the active company");
      const created = await tx.unitConversion.create({
        data: { companyId: context.companyId, ...input, factor: new Prisma.Decimal(input.factor) },
        include: {
          fromUnit: { select: { id: true, name: true, symbol: true } },
          toUnit: { select: { id: true, name: true, symbol: true } },
        },
      });
      await writeAuditLog({
        companyId: context.companyId, actorId: context.userId,
        action: "UNIT_CONVERSION_CREATED", entityType: "UnitConversion", entityId: created.id,
        changes: { fromUnitId: input.fromUnitId, toUnitId: input.toUnitId, factor: input.factor },
        ipAddress: requestIp(request), userAgent: requestUserAgent(request),
      }, tx);
      return created;
    });
    return successResponse({ conversion: { ...conversion, factor: conversion.factor.toString() } }, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("A conversion between these units already exists"));
    }
    return errorResponse(error);
  }
}
