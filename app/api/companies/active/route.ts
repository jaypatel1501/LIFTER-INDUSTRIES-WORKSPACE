import { errorResponse, successResponse } from "@/lib/api-response";
import { AuthorizationError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requireSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { createCompanySwitchProof } from "@/lib/security";
import { z } from "zod";

const schema = z.object({ companyId: z.string().cuid() });

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await enforceRateLimit(rateLimitKey("company-switch", session.user.id), 30, 60_000);
    const { companyId } = schema.parse(await readJson(request));
    const membership = await prisma.membership.findFirst({
      where: { userId: session.user.id, companyId, status: "ACTIVE" },
      select: { companyId: true },
    });
    if (!membership) throw new AuthorizationError("Active company membership required");
    return successResponse({
      activeCompanyId: companyId,
      switchProof: createCompanySwitchProof({
        userId: session.user.id,
        companyId,
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request) ?? null,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
