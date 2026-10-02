import bcrypt from "bcryptjs";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { readJson, requestIp } from "@/lib/request";
import { passwordChangeSchema } from "@/lib/validation/auth";

export async function PUT(request: Request) {
  try {
    const session = await requireSession();
    await enforceRateLimit(rateLimitKey("password-change", session.user.id), 5, 15 * 60_000);
    const input = passwordChangeSchema.parse(await readJson(request));
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true, memberships: { select: { companyId: true } } },
    });
    if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw new ValidationError("Current password is incorrect");
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    const ipAddress = requestIp(request);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: session.user.id },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
      });
      await tx.authSession.updateMany({
        where: { userId: session.user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      for (const membership of user.memberships) {
        await writeAuditLog(
          {
            companyId: membership.companyId,
            actorId: session.user.id,
            action: "AUTH_PASSWORD_CHANGED",
            entityType: "User",
            entityId: session.user.id,
            ipAddress,
          },
          tx,
        );
      }
    });
    return successResponse({ message: "Password changed. Please sign in again." });
  } catch (error) {
    return errorResponse(error);
  }
}
