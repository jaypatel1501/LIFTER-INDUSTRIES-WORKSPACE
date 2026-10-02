import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { cancelVoucherDraft } from "@/lib/accounting/voucher-platform";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { requestIp, requestUserAgent } from "@/lib/request";

type RouteContext = { params: Promise<{ voucherId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("vouchers", "cancel");
    await enforceRateLimit(rateLimitKey("voucher-cancel", context.userId), 30, 60_000);
    const { voucherId } = await route.params;
    const result = await cancelVoucherDraft(context, voucherId, request.headers.get("Idempotency-Key"), {
      ipAddress: requestIp(request),
      ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
    });
    return successResponse({ voucher: result.voucher, replayed: result.replayed });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Cancellation key has already been used"));
    }
    return errorResponse(error);
  }
}
