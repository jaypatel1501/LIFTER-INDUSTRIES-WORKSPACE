import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { hashSecret } from "@/lib/security";
import { ValidationError } from "@/lib/errors";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invitation = await prisma.companyInvitation.findFirst({
      where: {
        invitationTokenHash: hashSecret(token),
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      include: {
        company: { select: { id: true, name: true } },
        invitedByUser: { select: { id: true, name: true, email: true } },
      },
    });
    if (!invitation) throw new ValidationError("This invitation is invalid, expired, or no longer active.");
    return successResponse({
      companyName: invitation.company.name,
      inviterName: invitation.invitedByUser.name ?? invitation.invitedByUser.email,
      invitationId: invitation.id,
    }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
