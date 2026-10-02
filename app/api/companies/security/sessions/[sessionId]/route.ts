import { errorResponse, successResponse } from "@/lib/api-response";
import { AuthorizationError, ConflictError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requestIp, requestUserAgent } from "@/lib/request";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const context = await requirePermission("sessions", "revoke");
    await enforceRateLimit(rateLimitKey("session-revoke", context.userId), 60, 60 * 60_000);
    const { sessionId } = await params;
    await prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findFirst({
        where: {
          id: sessionId,
          user: { memberships: { some: { companyId: context.companyId } } },
        },
        select: { id: true, userId: true, revokedAt: true },
      });
      if (!session) throw new AuthorizationError("Company user session not found");
      if (session.revokedAt) throw new ConflictError("This session is already revoked");
      const revoked = await tx.authSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) throw new ConflictError("This session was revoked by another request");
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "COMPANY_USER_SESSION_REVOKED",
        entityType: "AuthSession",
        entityId: session.id,
        changes: { userId: session.userId },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
    });
    return successResponse({ revoked: true });
  } catch (error) {
    return errorResponse(error);
  }
}
