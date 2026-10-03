import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { convertSalesDocument } from "@/lib/sales/sales-service";
import { salesConvertSchema } from "@/lib/validation/sales";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, route: RouteContext) {
  try {
    const context = await requirePermission("sales", "create");
    await enforceRateLimit(rateLimitKey("sales-convert", context.userId), 30, 60_000);
    const { documentId } = await route.params;
    const result = await convertSalesDocument(
      context, documentId, salesConvertSchema.parse(await readJson(request)),
      request.headers.get("Idempotency-Key"),
      { ipAddress: requestIp(request), ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}) },
    );
    return successResponse({ document: result.document, replayed: result.replayed }, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Sales document number or idempotency key already exists"));
    }
    return errorResponse(error);
  }
}
