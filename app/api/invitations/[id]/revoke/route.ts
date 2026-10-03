import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requirePermission, requireSession } from "@/lib/permissions";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    await requirePermission("members", "invite");
    const { id } = await params;
    await prisma.companyInvitation.update({ where: { id }, data: { status: "REVOKED" } });
    return successResponse({ message: "Invitation revoked." }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
