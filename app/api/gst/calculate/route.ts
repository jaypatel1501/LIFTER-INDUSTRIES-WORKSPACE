import { errorResponse, successResponse } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { calculateGST } from "@/lib/gst/engine";
import { requirePermission } from "@/lib/permissions";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { readJson } from "@/lib/request";
import { gstCalculationSchema } from "@/lib/validation/gst";

export async function POST(request: Request) {
  try {
    const context = await requirePermission("company", "read");
    await enforceRateLimit(rateLimitKey("gst-calculate", context.userId), 120, 60_000);
    const input = gstCalculationSchema.parse(await readJson(request));
    if (!context.company.stateCode) {
      throw new ValidationError("Configure the active company's state code before calculating GST");
    }
    return successResponse({
      calculation: calculateGST({
        ...input,
        companyStateCode: context.company.stateCode,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
