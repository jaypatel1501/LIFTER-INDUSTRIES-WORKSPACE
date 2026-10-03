import { errorResponse, successResponse } from "@/lib/api-response";
import { NotFoundError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(_request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("purchases", "read");
    await enforceRateLimit(rateLimitKey("purchase-detail", context.userId), 120, 60_000);
    const { documentId } = await route.params;
    const document = await prisma.purchaseDocument.findFirst({
      where: { id: documentId, companyId: context.companyId },
      include: {
        party: { select: { id: true, name: true, email: true, phone: true, gstin: true } },
        sourceDocument: { select: { id: true, documentNumber: true, documentType: true } },
        lines: { orderBy: { lineNumber: "asc" }, include: { item: { select: { id: true, name: true, code: true } }, warehouse: { select: { id: true, name: true } } } },
        events: { orderBy: { createdAt: "asc" }, select: { id: true, eventType: true, snapshot: true, createdAt: true } },
        voucher: { select: { id: true, voucherNumber: true, status: true } },
      },
    });
    if (!document) throw new NotFoundError("Purchase document not found in the current company");
    return successResponse({ document });
  } catch (error) {
    return errorResponse(error);
  }
}
