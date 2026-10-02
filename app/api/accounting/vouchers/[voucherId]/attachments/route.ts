import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requireEnv } from "@/lib/env";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requestIp, requestUserAgent } from "@/lib/request";
import { writeAuditLog } from "@/lib/audit";

const maximumBytes = 10 * 1024 * 1024;
const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
type RouteContext = { params: Promise<{ voucherId: string }> };

function validFile(type: string, bytes: Uint8Array) {
  if (type === "application/pdf") return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (type === "image/png") {
    return bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/webp") {
    return bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("vouchers", "update");
    await enforceRateLimit(rateLimitKey("voucher-attachment", context.userId), 20, 60_000);
    const { voucherId } = await route.params;
    const voucher = await prisma.accountingVoucher.findFirst({
      where: { id: voucherId, companyId: context.companyId, status: "DRAFT" },
      select: { id: true },
    });
    if (!voucher) throw new NotFoundError("Only a draft voucher in the current company can receive attachments");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Select a voucher attachment");
    if (file.size < 1 || file.size > maximumBytes) throw new ValidationError("Attachments must be smaller than 10 MB");
    if (!allowedTypes.has(file.type)) throw new ValidationError("Use a PDF, JPEG, PNG or WebP attachment");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validFile(file.type, bytes)) throw new ValidationError("The uploaded file does not match its declared type");

    const blob = await put(
      `companies/${context.companyId}/vouchers/${voucher.id}/${randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120)}`,
      Buffer.from(bytes),
      { access: "private", contentType: file.type, addRandomSuffix: false, token: requireEnv("BLOB_READ_WRITE_TOKEN") },
    );
    try {
      const attachment = await prisma.$transaction(async (tx) => {
        const draft = await tx.accountingVoucher.updateMany({
          where: { id: voucher.id, companyId: context.companyId, status: "DRAFT" },
          data: { updatedAt: new Date() },
        });
        if (draft.count !== 1) throw new ConflictError("Voucher stopped being a draft before the attachment could be saved");
        const created = await tx.voucherAttachment.create({
          data: {
            companyId: context.companyId,
            voucherId: voucher.id,
            objectKey: blob.pathname,
            url: blob.url,
            fileName: file.name.slice(0, 255),
            contentType: file.type,
            byteSize: file.size,
            createdById: context.userId,
          },
        });
        await writeAuditLog({
          companyId: context.companyId,
          actorId: context.userId,
          action: "VOUCHER_ATTACHMENT_ADDED",
          entityType: "VoucherAttachment",
          entityId: created.id,
          changes: { voucherId: voucher.id, fileName: created.fileName, contentType: created.contentType, byteSize: created.byteSize },
          ipAddress: requestIp(request),
          userAgent: requestUserAgent(request),
        }, tx);
        return created;
      });
      return successResponse({ attachment: { ...attachment, downloadUrl: `/api/accounting/vouchers/${voucher.id}/attachments/${attachment.id}` } }, 201);
    } catch (error) {
      try {
        await del(blob.url, { token: requireEnv("BLOB_READ_WRITE_TOKEN") });
      } catch (cleanupError) {
        console.error("Voucher attachment compensation failed", cleanupError instanceof Error ? cleanupError.name : "UnknownError");
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
