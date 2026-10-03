import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { decideVoucherApproval } from "@/lib/accounting/voucher-platform";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { voucherApprovalSchema } from "@/lib/validation/vouchers";

type RouteContext = { params: Promise<{ voucherId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("vouchers", "approve");
    await enforceRateLimit(rateLimitKey("voucher-approval", context.userId), 30, 60_000);
    const { voucherId } = await route.params;
    const input = voucherApprovalSchema.parse(await readJson(request));
    const result = await decideVoucherApproval(
      context,
      voucherId,
      input.decision,
      input.reason || undefined,
      request.headers.get("Idempotency-Key"),
      {
        ipAddress: requestIp(request),
        ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
      },
    );
    return successResponse(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Approval key has already been used"));
    }
    return errorResponse(error);
  }
}
