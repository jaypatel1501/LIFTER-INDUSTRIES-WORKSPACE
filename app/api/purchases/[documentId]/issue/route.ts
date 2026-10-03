import { errorResponse, successResponse } from "@/lib/api-response";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { requestIp, requestUserAgent } from "@/lib/request";
import { issuePurchaseOrder } from "@/lib/purchases/purchase-service";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("purchases", "issue");
    await enforceRateLimit(rateLimitKey("purchase-issue", context.userId), 30, 60_000);
    const { documentId } = await route.params;
    const result = await issuePurchaseOrder(context, documentId, request.headers.get("Idempotency-Key"), {
      ipAddress: requestIp(request), ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
    });
    return successResponse({ document: result.document, replayed: result.replayed });
  } catch (error) {
    return errorResponse(error);
  }
}
