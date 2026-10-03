import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { hashSecret } from "@/lib/security";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invitation = await prisma.companyInvitation.findFirst({
      where: {
        invitationTokenHash: hashSecret(token),
      },
    });
    if (!invitation) {
      return successResponse({ message: "Invitation no longer exists." }, 200);
    }
    await prisma.companyInvitation.update({
      where: { id: invitation.id },
      data: { status: "REVOKED" },
    });
    return successResponse({ message: "Invitation declined.", status: "REVOKED" }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
