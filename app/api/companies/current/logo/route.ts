import { get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { requestIp, requestUserAgent } from "@/lib/request";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requireEnv } from "@/lib/env";

const maximumLogoBytes = 2 * 1024 * 1024;

export async function GET() {
  try {
    const context = await requirePermission("company", "read");
    const company = await prisma.company.findFirst({
      where: { id: context.companyId },
      select: { logoUrl: true },
    });
    if (!company?.logoUrl) {
      return Response.json(
        { success: false, data: null, error: { code: "NOT_FOUND", message: "Company logo not found" } },
        { status: 404 },
      );
    }
    const blob = await get(company.logoUrl, {
      access: "private",
      token: requireEnv("BLOB_READ_WRITE_TOKEN"),
    });
    if (!blob) {
      return Response.json(
        { success: false, data: null, error: { code: "NOT_FOUND", message: "Company logo not found" } },
        { status: 404 },
      );
    }
    const headers = new Headers();
    blob.headers.forEach((value, key) => headers.set(key, value));
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(blob.stream, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

function validImage(type: string, bytes: Uint8Array) {
  if (type === "image/png") {
    return bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/webp") {
    return bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("company", "update");
    await enforceRateLimit(rateLimitKey("company-logo", context.companyId), 5, 60 * 60_000);
    const form = await request.formData();
    const file = form.get("logo");
    if (!(file instanceof File)) {
      return Response.json(
        { success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Select an image file" } },
        { status: 400 },
      );
    }
    if (file.size === 0 || file.size > maximumLogoBytes) {
      return Response.json(
        { success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Logo must be smaller than 2 MB" } },
        { status: 400 },
      );
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    if (!validImage(file.type, buffer)) {
      return Response.json(
        { success: false, data: null, error: { code: "VALIDATION_ERROR", message: "Use a valid PNG, JPEG or WebP image" } },
        { status: 400 },
      );
    }
    const blob = await put(
      `companies/${context.companyId}/logo-${randomUUID()}`,
      Buffer.from(buffer),
      {
        access: "private",
        contentType: file.type,
        addRandomSuffix: false,
        token: requireEnv("BLOB_READ_WRITE_TOKEN"),
      },
    );
    const company = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: context.companyId },
        data: { logoUrl: blob.url },
        select: { id: true, logoUrl: true },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "COMPANY_LOGO_UPDATED",
        entityType: "Company",
        entityId: context.companyId,
        changes: { logoUrl: blob.url, contentType: file.type, size: file.size },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return updated;
    });
    return successResponse({ company });
  } catch (error) {
    return errorResponse(error);
  }
}
