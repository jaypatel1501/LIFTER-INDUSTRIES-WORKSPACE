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
import { gstAdjustmentSchema, getGSTPeriodBounds } from "@/lib/validation/gst";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function GET(request: Request) {
  try {
    const context = await requirePermission("company", "read");
    const periodKey = new URL(request.url).searchParams.get("periodKey");
    const { start, end } = periodKey
      ? getGSTPeriodBounds(periodKey)
      : { start: undefined, end: undefined };
    const adjustments = await prisma.gSTAdjustment.findMany({
      where: {
        companyId: context.companyId,
        ...(periodKey ? { periodKey } : {}),
        ...(start && end ? { noteDate: { gte: start, lt: end } } : {}),
      },
      orderBy: [{ noteDate: "desc" }, { noteNumber: "desc" }],
      take: 100,
    });
    return successResponse({
      adjustments: adjustments.map((adjustment) => ({
        ...adjustment,
        taxableAmount: adjustment.taxableAmount.toFixed(2),
        cgstAmount: adjustment.cgstAmount.toFixed(2),
        sgstAmount: adjustment.sgstAmount.toFixed(2),
        utgstAmount: adjustment.utgstAmount.toFixed(2),
        igstAmount: adjustment.igstAmount.toFixed(2),
        cessAmount: adjustment.cessAmount.toFixed(2),
        noteDate: adjustment.noteDate.toISOString().slice(0, 10),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("company", "update");
    await enforceRateLimit(rateLimitKey("gst-adjustment-write", context.userId), 20, 60_000);
    const input = gstAdjustmentSchema.parse(await readJson(request));
    if (input.noteDate.slice(0, 7) !== input.periodKey) {
      throw new ValidationError("The note date must be in the selected return period");
    }
    const rawKey = request.headers.get("Idempotency-Key");
    if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
    const idempotencyKey = hashIdempotencyKey(rawKey);
    const requestHash = digest(input);
    const adjustment = await withTransaction(async (tx) => {
      const previous = await tx.gSTAdjustment.findUnique({
        where: { companyId_idempotencyKey: { companyId: context.companyId, idempotencyKey } },
      });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictError("Idempotency-Key was used for a different GST adjustment");
        return { adjustment: previous, replayed: true };
      }
      const period = await tx.gSTPeriod.findUnique({
        where: { companyId_periodKey: { companyId: context.companyId, periodKey: input.periodKey } },
        select: { isLocked: true },
      });
      if (period?.isLocked) throw new ConflictError("GST adjustments cannot be added to a locked period");
      const voucher = await tx.accountingVoucher.findFirst({
        where: {
          companyId: context.companyId,
          voucherNumber: input.voucherNumber,
          type: input.adjustmentType,
          status: "POSTED",
          voucherDate: new Date(`${input.noteDate}T00:00:00.000Z`),
        },
        select: { id: true },
      });
      if (!voucher) {
        throw new ConflictError("Link the adjustment to a posted credit/debit note voucher dated on the note date");
      }
      const taxDetails = await tx.voucherTaxDetail.findMany({
        where: {
          companyId: context.companyId,
          line: { voucherId: voucher.id },
          taxType: { in: ["CGST", "SGST", "UTGST", "IGST", "CESS"] },
        },
        select: { voucherLineId: true, taxType: true, taxableAmount: true, taxAmount: true },
      });
      const taxableByLine = new Map<string, Prisma.Decimal>();
      const taxByType = new Map<string, Prisma.Decimal>();
      for (const detail of taxDetails) {
        taxableByLine.set(detail.voucherLineId, detail.taxableAmount);
        taxByType.set(
          detail.taxType,
          (taxByType.get(detail.taxType) ?? new Prisma.Decimal(0)).plus(detail.taxAmount),
        );
      }
      const voucherTaxableAmount = [...taxableByLine.values()].reduce(
        (sum, amount) => sum.plus(amount),
        new Prisma.Decimal(0),
      );
      if (voucherTaxableAmount.minus(input.taxableAmount).abs().greaterThan("0.01")) {
        throw new ConflictError("Adjustment taxable amount must match the linked posted voucher");
      }
      for (const [taxType, field] of [
        ["CGST", "cgstAmount"], ["SGST", "sgstAmount"], ["UTGST", "utgstAmount"],
        ["IGST", "igstAmount"], ["CESS", "cessAmount"],
      ] as const) {
        if ((taxByType.get(taxType) ?? new Prisma.Decimal(0)).minus(input[field]).abs().greaterThan("0.01")) {
          throw new ConflictError(`Adjustment ${field} must match the linked posted voucher`);
        }
      }
      const created = await tx.gSTAdjustment.create({
        data: {
          companyId: context.companyId,
          actorId: context.userId,
          voucherId: voucher.id,
          periodKey: input.periodKey,
          adjustmentType: input.adjustmentType,
          side: input.side,
          noteNumber: input.noteNumber,
          noteDate: new Date(`${input.noteDate}T00:00:00.000Z`),
          counterpartyGstin: input.counterpartyGstin || null,
          taxableAmount: input.taxableAmount,
          cgstAmount: input.cgstAmount,
          sgstAmount: input.sgstAmount,
          utgstAmount: input.utgstAmount,
          igstAmount: input.igstAmount,
          cessAmount: input.cessAmount,
          reason: input.reason,
          idempotencyKey,
          requestHash,
        },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "GST_NOTE_ADJUSTMENT_CREATED",
        entityType: "GSTAdjustment",
        entityId: created.id,
        reason: input.reason,
        changes: {
          periodKey: input.periodKey,
          noteNumber: input.noteNumber,
          adjustmentType: input.adjustmentType,
          side: input.side,
          taxableAmount: input.taxableAmount,
        },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return { adjustment: created, replayed: false };
    });
    return successResponse(adjustment, 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("GST note number or idempotency key already exists"));
    }
    return errorResponse(error);
  }
}
