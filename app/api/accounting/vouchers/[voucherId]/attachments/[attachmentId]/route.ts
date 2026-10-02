import { get } from "@vercel/blob";
import { errorResponse } from "@/lib/api-response";
import { NotFoundError } from "@/lib/errors";
import { requireEnv } from "@/lib/env";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ voucherId: string; attachmentId: string }> };

export async function GET(_request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("vouchers", "read");
    const { voucherId, attachmentId } = await route.params;
    const attachment = await prisma.voucherAttachment.findFirst({
      where: { id: attachmentId, voucherId, companyId: context.companyId },
      select: { url: true, fileName: true, contentType: true },
    });
    if (!attachment) throw new NotFoundError("Voucher attachment not found in the current company");
    const blob = await get(attachment.url, { access: "private", token: requireEnv("BLOB_READ_WRITE_TOKEN") });
    if (!blob) throw new NotFoundError("Voucher attachment is unavailable in object storage");
    const headers = new Headers();
    blob.headers.forEach((value, key) => headers.set(key, value));
    headers.set("Content-Type", attachment.contentType);
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(blob.stream, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
