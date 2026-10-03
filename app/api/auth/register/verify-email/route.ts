import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { hashSecret } from "@/lib/security";
import { ValidationError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const ip = requestIp(request);
    const userAgent = requestUserAgent(request);
    await enforceRateLimit(rateLimitKey("register-verify-email-ip", ip), 10, 60 * 60_000);
    const body = await readJson(request);
    const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const token = typeof payload.token === "string" ? payload.token : "";
    if (!token) throw new ValidationError("Verification token is required");
    const tokenHash = hashSecret(token);
    const record = await prisma.emailVerificationToken.findFirst({
      where: { tokenHash, consumedAt: null },
      include: { registrationAttempt: true },
    });
    if (!record || record.expiresAt <= new Date()) {
      throw new ValidationError("This verification link is invalid or expired.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date(), requestIp: ip, userAgent: userAgent ?? null },
      });
      await tx.registrationAttempt.update({
        where: { id: record.registrationAttemptId ?? record.registrationAttempt?.id ?? "" },
        data: {
          emailVerifiedAt: new Date(),
          status: "EMAIL_VERIFIED",
          requestIp: ip,
        },
      });
    });
    return successResponse({ message: "Email verified successfully. Continue to mobile verification.", success: true }, 200);
  } catch (error) {
    return errorResponse(error);
  }
}
