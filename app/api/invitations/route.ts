import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requirePermission, requireSession } from "@/lib/permissions";
import { readJson } from "@/lib/request";
import { createOpaqueToken, hashSecret } from "@/lib/security";
import { ValidationError } from "@/lib/errors";

const inviteSchema = z.object({
  companyId: z.string().cuid(),
  email: z.string().email(),
  roleId: z.string().cuid().optional(),
  name: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await requirePermission("members", "invite");
    const input = inviteSchema.parse(await readJson(request));
    const company = await prisma.company.findUnique({ where: { id: input.companyId }, select: { id: true, name: true } });
    if (!company) throw new ValidationError("Company not found.");
    const token = createOpaqueToken();
    const invitation = await prisma.companyInvitation.create({
      data: {
        companyId: company.id,
        invitedEmail: input.email,
        invitedName: input.name ?? null,
        roleId: input.roleId ?? null,
        invitationTokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        invitedByUserId: session.user.id,
      },
    });
    return successResponse({ invitationId: invitation.id, companyName: company.name }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
