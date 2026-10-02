import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { sendSalesDocument } from "@/lib/sales/sales-communications";
import { z } from "zod";

type RouteContext = { params: Promise<{ documentId: string }> };
const sendSchema = z.object({ channel: z.enum(["EMAIL", "WHATSAPP"]) });

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("sales", "send");
    await enforceRateLimit(rateLimitKey("sales-send", context.userId), 10, 60_000);
    const { documentId } = await route.params;
    const input = sendSchema.parse(await readJson(request));
    const result = await sendSalesDocument(
      context,
      documentId,
      input.channel,
      request.headers.get("Idempotency-Key"),
      { ipAddress: requestIp(request), ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}) },
    );
    return successResponse(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("This communication idempotency key has already been used"));
    }
    return errorResponse(error);
  }
}
