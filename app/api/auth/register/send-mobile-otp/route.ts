import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requestIp, requestUserAgent, readJson } from "@/lib/request";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { createOtpCode, hashSecret } from "@/lib/security";
import { otpRequestSchema } from "@/lib/validation/auth";
import { createSmsAdapter, otpMessage } from "@/lib/sms";
import { ValidationError } from "@/lib/errors";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  try {
    const ip = requestIp(request);
    const userAgent = requestUserAgent(request);
    await enforceRateLimit(rateLimitKey("register-mobile-otp-ip", ip), 5, 60 * 60_000);
    const input = otpRequestSchema.parse(await readJson(request));
    const attempt = await prisma.registrationAttempt.findFirst({
      where: {
        mobileNumber: input.mobile,
        status: { in: ["STARTED", "EMAIL_VERIFIED", "MOBILE_VERIFIED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!attempt) throw new ValidationError("Your registration must be verified before mobile OTP can be sent.");
    if (env.NODE_ENV === "production" && !env.SMS_PROVIDER) {
      throw new ValidationError("Mobile OTP service is not configured.");
    }
    const otp = createOtpCode();
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const record = await prisma.mobileOtp.create({
      data: {
        registrationAttemptId: attempt.id,
        mobileNumber: input.mobile,
        otpHash: hashSecret(otp),
        purpose: "REGISTRATION",
        expiresAt,
        maxAttempts: 5,
        requestIp: ip,
        userAgent: userAgent ?? null,
      },
    });
    if (env.NODE_ENV !== "production" && env.DEV_OTP_MODE) {
      return successResponse({ message: "Development OTP mode is active. Use the code returned in the response.", code: otp, otpId: record.id }, 200);
    }
    try {
      const sms = createSmsAdapter();
      await sms.send(input.mobile, otpMessage(otp));
    } catch {
      await prisma.mobileOtp.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
      throw new ValidationError("Mobile OTP service is not configured or unavailable.");
    }
    return successResponse({ message: "A verification code has been sent to your mobile number.", otpId: record.id }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
