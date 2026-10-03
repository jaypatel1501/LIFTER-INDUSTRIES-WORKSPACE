import { OtpPurpose } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requestIp, readJson } from "@/lib/request";
import { createOtpCode, hashSecret } from "@/lib/security";
import { otpRequestSchema } from "@/lib/validation/auth";
import { createSmsAdapter, otpMessage } from "@/lib/sms";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    const ip = requestIp(request);
    await enforceRateLimit(rateLimitKey("otp-request-ip", ip), 3, 15 * 60_000);
    const input = otpRequestSchema.parse(await readJson(request));
    await enforceRateLimit(rateLimitKey("otp-request-mobile", input.mobile), 3, 15 * 60_000);
    const sms = createSmsAdapter();

    const user = await prisma.user.findUnique({
      where: { mobile: input.mobile },
      select: { id: true, memberships: { select: { companyId: true } } },
    });
    if (user) {
      const code = createOtpCode();
      const challenge = await prisma.$transaction(async (tx) => {
        await tx.otpChallenge.updateMany({
          where: { userId: user.id, purpose: OtpPurpose.LOGIN, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        const item = await tx.otpChallenge.create({
          data: {
            userId: user.id,
            purpose: OtpPurpose.LOGIN,
            codeHash: hashSecret(code),
            expiresAt: new Date(Date.now() + 15 * 60_000),
          },
        });
        for (const membership of user.memberships) {
          await writeAuditLog(
            {
              companyId: membership.companyId,
              actorId: user.id,
              action: "AUTH_OTP_REQUEST",
              entityType: "User",
              entityId: user.id,
              ipAddress: ip,
            },
            tx,
          );
        }
        return item;
      });
      try {
        await sms.send(input.mobile, otpMessage(code));
      } catch (error) {
        await prisma.otpChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        });
        throw error;
      }
    }
    return successResponse(
      { message: "If the mobile number is registered, a verification code has been sent." },
      202,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
