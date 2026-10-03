import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requirePermission, requireSession } from "@/lib/permissions";
import { createOpaqueToken, hashSecret } from "@/lib/security";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    await requirePermission("members", "invite");
    const { id } = await params;
    const invitation = await prisma.companyInvitation.findUnique({ where: { id }, select: { id: true, invitedEmail: true, companyId: true } });
    if (!invitation) return successResponse({ message: "Invitation not found." }, 404);
    const token = createOpaqueToken();
    await prisma.companyInvitation.update({
      where: { id: invitation.id },
      data: { invitationTokenHash: hashSecret(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) },
    });
    return successResponse({ message: "Invitation resent.", invitationId: invitation.id }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
