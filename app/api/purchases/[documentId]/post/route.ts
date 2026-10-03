import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { postPurchaseDocument } from "@/lib/purchases/purchase-service";
import { purchasePostSchema } from "@/lib/validation/purchases";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("purchases", "post");
    await enforceRateLimit(rateLimitKey("purchase-post", context.userId), 20, 60_000);
    const { documentId } = await route.params;
    const result = await postPurchaseDocument(context, documentId, purchasePostSchema.parse(await readJson(request)), request.headers.get("Idempotency-Key"), {
      ipAddress: requestIp(request), ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
    });
    return successResponse({ document: result.document, voucher: result.voucher, replayed: result.replayed });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return errorResponse(new ConflictError("Purchase posting key, voucher, or supplier reference already exists"));
    return errorResponse(error);
  }
}
