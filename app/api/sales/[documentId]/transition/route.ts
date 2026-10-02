import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { transitionSalesDocument } from "@/lib/sales/sales-service";
import { salesTransitionSchema } from "@/lib/validation/sales";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const input = salesTransitionSchema.parse(await readJson(request));
    const context = await requirePermission("sales", input.action === "ISSUE" ? "issue" : "update");
    await enforceRateLimit(rateLimitKey("sales-transition", context.userId), 30, 60_000);
    const { documentId } = await route.params;
    const result = await transitionSalesDocument(
      context, documentId, input.action, request.headers.get("Idempotency-Key"), input.reason,
      { ipAddress: requestIp(request), ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}) },
    );
    return successResponse({ document: result.document, replayed: result.replayed });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Sales event idempotency key already exists"));
    }
    return errorResponse(error);
  }
}
