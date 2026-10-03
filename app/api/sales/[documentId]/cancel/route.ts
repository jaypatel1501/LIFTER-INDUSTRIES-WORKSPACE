import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { cancelSalesDocument } from "@/lib/sales/sales-service";
import { salesCancelSchema } from "@/lib/validation/sales";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("sales", "cancel");
    await enforceRateLimit(rateLimitKey("sales-cancel", context.userId), 15, 60_000);
    const { documentId } = await route.params;
    const input = salesCancelSchema.parse(await readJson(request));
    const result = await cancelSalesDocument(
      context,
      documentId,
      input.reversalDate,
      request.headers.get("Idempotency-Key"),
      input.reason,
      { ipAddress: requestIp(request), ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}) },
    );
    return successResponse({ document: result.document, replayed: result.replayed });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Sales cancellation key or reversal voucher already exists"));
    }
    return errorResponse(error);
  }
}
