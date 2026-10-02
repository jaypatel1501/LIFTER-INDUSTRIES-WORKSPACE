import { errorResponse, successResponse } from "@/lib/api-response";
import { AppError, AuthorizationError } from "@/lib/errors";
import { sendCompanyInvitationEmail, requireEmailConfiguration } from "@/lib/email";
import { writeAuditLog } from "@/lib/audit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requestIp, requestUserAgent } from "@/lib/request";
import { createOpaqueToken, getLoginUrl, getPasswordResetUrl, hashSecret } from "@/lib/security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  try {
    const context = await requirePermission("members", "invite");
    await enforceRateLimit(rateLimitKey("member-invitation-resend", context.companyId), 10, 60 * 60_000);
    requireEmailConfiguration();
    const loginUrl = getLoginUrl();
    const { membershipId } = await params;
    const invitation = await prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { id: membershipId, companyId: context.companyId, status: "INVITED" },
        select: {
          id: true,
          user: { select: { id: true, email: true, emailVerifiedAt: true } },
        },
      });
      if (!membership) throw new AuthorizationError("Pending company invitation not found");
      const needsPasswordSetup = !membership.user.emailVerifiedAt;
      const token = needsPasswordSetup ? createOpaqueToken() : null;
      if (token) {
        await tx.passwordResetToken.updateMany({
          where: { userId: membership.user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            userId: membership.user.id,
            tokenHash: hashSecret(token),
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
      }
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "COMPANY_MEMBER_INVITATION_RESENT",
        entityType: "Membership",
        entityId: membership.id,
        changes: { email: membership.user.email },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return { membership, needsPasswordSetup, token };
    });
    const link = invitation.token
      ? getPasswordResetUrl(invitation.token)
      : loginUrl;
    try {
      await sendCompanyInvitationEmail(
        invitation.membership.user.email,
        context.company.name,
        link,
        invitation.needsPasswordSetup,
      );
    } catch (error) {
      console.error("Company invitation email delivery failed", error instanceof Error ? error.name : "UnknownError");
      throw new AppError(
        "The invitation remains pending, but email delivery failed. Retry sending it later.",
        502,
        "INVITATION_DELIVERY_FAILED",
      );
    }
    return successResponse({ resent: true });
  } catch (error) {
    return errorResponse(error);
  }
}
