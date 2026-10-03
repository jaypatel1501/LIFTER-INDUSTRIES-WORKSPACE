import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { requestIp, requestUserAgent } from "@/lib/request";
import { postSalesDocument } from "@/lib/sales/sales-service";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("sales", "post");
    await enforceRateLimit(rateLimitKey("sales-post", context.userId), 20, 60_000);
    const { documentId } = await route.params;
    const result = await postSalesDocument(
      context, documentId, request.headers.get("Idempotency-Key"),
      { ipAddress: requestIp(request), ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}) },
    );
    return successResponse({ document: result.document, voucher: result.voucher, replayed: result.replayed });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Sales posting key or voucher number already exists"));
    }
    return errorResponse(error);
  }
}
