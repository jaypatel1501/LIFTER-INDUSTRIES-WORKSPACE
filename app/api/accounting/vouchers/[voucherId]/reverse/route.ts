import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { reversePostedVoucher } from "@/lib/accounting/voucher-platform";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { z } from "zod";

const reverseSchema = z.object({
  reversalDate: z.string().date(),
  reason: z.string().trim().min(5).max(500),
});
type RouteContext = { params: Promise<{ voucherId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("vouchers", "reverse");
    await enforceRateLimit(rateLimitKey("voucher-reversal", context.userId), 20, 60_000);
    const { voucherId } = await route.params;
    const input = reverseSchema.parse(await readJson(request));
    const result = await reversePostedVoucher(
      context,
      voucherId,
      input.reversalDate,
      request.headers.get("Idempotency-Key"),
      input.reason,
      {
        ipAddress: requestIp(request),
        ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
      },
    );
    return successResponse({ voucher: result.voucher, replayed: result.replayed });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Reversal key, voucher number, or reversal link already exists"));
    }
    return errorResponse(error);
  }
}
