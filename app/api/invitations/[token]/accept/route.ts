import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson } from "@/lib/request";
import { hashSecret } from "@/lib/security";
import { ValidationError } from "@/lib/errors";

const schema = z.object({ email: z.string().email().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const input = schema.parse(await readJson(request));
    const invitation = await prisma.companyInvitation.findFirst({
      where: {
        invitationTokenHash: hashSecret(token),
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    });
    if (!invitation) throw new ValidationError("This invitation is invalid or expired.");
    const user = await prisma.user.findFirst({
      where: { normalizedEmail: input.email ?? invitation.invitedEmail },
      select: { id: true, email: true },
    });
    if (!user) {
      return successResponse({ message: "Please complete your account registration before accepting this invitation.", needsRegistration: true }, 202);
    }
    const membership = await prisma.membership.findFirst({ where: { userId: user.id, companyId: invitation.companyId }, select: { id: true } });
    if (!membership) {
      const created = await prisma.membership.create({
        data: {
          userId: user.id,
          companyId: invitation.companyId,
          status: "ACTIVE",
        },
      });
      if (invitation.roleId) {
        await prisma.membershipRole.create({ data: { membershipId: created.id, roleId: invitation.roleId } });
      }
    }
    await prisma.companyInvitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedByUserId: user.id, acceptedAt: new Date() },
    });
    return successResponse({ message: "Invitation accepted successfully.", companyId: invitation.companyId }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
