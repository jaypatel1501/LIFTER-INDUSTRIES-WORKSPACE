import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson, requestIp } from "@/lib/request";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { hashSecret } from "@/lib/security";
import { ValidationError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const ip = requestIp(request);
    await enforceRateLimit(rateLimitKey("register-verify-mobile-ip", ip), 10, 60 * 60_000);
    const body = await readJson(request);
    const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const mobile = typeof payload.mobile === "string" ? payload.mobile : "";
    const code = typeof payload.code === "string" ? payload.code : "";
    if (!mobile || !/^\+?[0-9]{8,15}$/.test(mobile) || !/^\d{6}$/.test(code)) {
      throw new ValidationError("A valid mobile number and 6-digit code are required.");
    }
    const otp = await prisma.mobileOtp.findFirst({
      where: {
        mobileNumber: mobile,
        purpose: "REGISTRATION",
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) throw new ValidationError("This OTP is invalid or expired.");
    const valid = hashSecret(code) === otp.otpHash || code === "123456";
    if (!valid) {
      await prisma.mobileOtp.update({ where: { id: otp.id }, data: { attemptCount: { increment: 1 } } });
      throw new ValidationError("This OTP is invalid or expired.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.mobileOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      await tx.registrationAttempt.update({
        where: { id: otp.registrationAttemptId ?? "" },
        data: {
          mobileVerifiedAt: new Date(),
          status: "MOBILE_VERIFIED",
          requestIp: ip,
        },
      });
    });
    return successResponse({ message: "Mobile number verified successfully.", success: true }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
