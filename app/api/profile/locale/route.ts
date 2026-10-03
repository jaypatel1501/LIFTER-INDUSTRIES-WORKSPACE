import { Locale } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requireSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requestIp, requestUserAgent, readJson } from "@/lib/request";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({ locale: z.nativeEnum(Locale) });

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    await enforceRateLimit(rateLimitKey("profile-locale", session.user.id), 10, 60_000);
    const { locale } = schema.parse(await readJson(request));
    const memberships = await prisma.membership.findMany({
      where: { userId: session.user.id, status: "ACTIVE" },
      select: { companyId: true },
    });
    const ipAddress = requestIp(request);
    const userAgent = requestUserAgent(request);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: session.user.id },
        data: { locale },
      });
      for (const membership of memberships) {
        await writeAuditLog(
          {
            companyId: membership.companyId,
            actorId: session.user.id,
            action: "PROFILE_LOCALE_CHANGED",
            entityType: "User",
            entityId: session.user.id,
            changes: { locale },
            ipAddress,
            userAgent,
          },
          tx,
        );
      }
    });
    return successResponse({ locale });
  } catch (error) {
    return errorResponse(error);
  }
}
