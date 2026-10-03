import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { cancelPurchaseDocument } from "@/lib/purchases/purchase-service";
import { purchaseCancelSchema } from "@/lib/validation/purchases";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("purchases", "cancel");
    await enforceRateLimit(rateLimitKey("purchase-cancel", context.userId), 15, 60_000);
    const { documentId } = await route.params;
    const input = purchaseCancelSchema.parse(await readJson(request));
    const result = await cancelPurchaseDocument(context, documentId, input.reversalDate, request.headers.get("Idempotency-Key"), input.reason, {
      ipAddress: requestIp(request), ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
    });
    return successResponse({ document: result.document, replayed: result.replayed });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return errorResponse(new ConflictError("Purchase cancellation key or reversal voucher already exists"));
    return errorResponse(error);
  }
}
