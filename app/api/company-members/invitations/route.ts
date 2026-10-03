import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requirePermission, requireSession } from "@/lib/permissions";

export async function GET() {
  try {
    await requireSession();
    const context = await requirePermission("members", "read");
    const invitations = await prisma.companyInvitation.findMany({
      where: { companyId: context.companyId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        invitedEmail: true,
        invitedName: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return successResponse({ invitations }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
