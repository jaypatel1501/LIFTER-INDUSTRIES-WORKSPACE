import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, ValidationError } from "@/lib/errors";
import { hashIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/permissions";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requestIp, requestUserAgent, readJson } from "@/lib/request";
import { withTransaction } from "@/lib/transactions";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getGSTPeriodBounds, gstPeriodSchema } from "@/lib/validation/gst";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function GET(request: Request) {
  try {
    const context = await requirePermission("company", "read");
    const periodKey = new URL(request.url).searchParams.get("periodKey");
    if (!periodKey) throw new ValidationError("periodKey is required");
    getGSTPeriodBounds(periodKey);
    const period = await prisma.gSTPeriod.findUnique({
      where: { companyId_periodKey: { companyId: context.companyId, periodKey } },
      include: { lockedBy: { select: { id: true, name: true, email: true } } },
    });
    return successResponse({ period });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("company", "update");
    await enforceRateLimit(rateLimitKey("gst-period-lock", context.userId), 20, 60_000);
    const input = gstPeriodSchema.parse(await readJson(request));
    const rawKey = request.headers.get("Idempotency-Key");
    if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
    const idempotencyKey = hashIdempotencyKey(rawKey);
    const requestHash = digest(input);
    const result = await withTransaction(async (tx) => {
      const previous = await tx.gSTPeriodEvent.findUnique({
        where: { companyId_idempotencyKey: { companyId: context.companyId, idempotencyKey } },
        include: { period: true },
      });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictError("Idempotency-Key was used for a different GST period action");
        return { period: previous.period, replayed: true };
      }
      const period = await tx.gSTPeriod.upsert({
        where: { companyId_periodKey: { companyId: context.companyId, periodKey: input.periodKey } },
        create: { companyId: context.companyId, periodKey: input.periodKey },
        update: {},
      });
      if (period.isLocked === (input.action === "LOCK")) {
        throw new ConflictError(input.action === "LOCK" ? "GST period is already locked" : "GST period is not locked");
      }
      const updated = await tx.gSTPeriod.update({
        where: { id: period.id },
        data: {
          isLocked: input.action === "LOCK",
          lockedAt: input.action === "LOCK" ? new Date() : null,
          lockedById: input.action === "LOCK" ? context.userId : null,
          lockReason: input.action === "LOCK" ? input.reason : null,
        },
      });
      await tx.gSTPeriodEvent.create({
        data: {
          companyId: context.companyId,
          periodId: period.id,
          actorId: context.userId,
          action: input.action,
          reason: input.reason,
          idempotencyKey,
          requestHash,
        },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: input.action === "LOCK" ? "GST_PERIOD_LOCKED" : "GST_PERIOD_UNLOCKED",
        entityType: "GSTPeriod",
        entityId: period.id,
        reason: input.reason,
        changes: { periodKey: input.periodKey, action: input.action },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return { period: updated, replayed: false };
    });
    return successResponse(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("This GST period action conflicts with a concurrent update"));
    }
    return errorResponse(error);
  }
}
