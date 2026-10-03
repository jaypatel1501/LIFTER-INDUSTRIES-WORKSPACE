import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requestIp, requestUserAgent, readJson } from "@/lib/request";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { createOpaqueToken, hashSecret } from "@/lib/security";
import { emailSchema } from "@/lib/validation/auth";
import { sendRegistrationVerificationEmail } from "@/lib/email";
import { getVerificationUrl, REGISTRATION_LIFETIME_MS } from "@/lib/registration";

export async function POST(request: Request) {
  try {
    const ip = requestIp(request);
    const userAgent = requestUserAgent(request);
    await enforceRateLimit(rateLimitKey("register-resend-email-ip", ip), 5, 60 * 60_000);
    const input = z.object({ email: emailSchema }).parse(await readJson(request));
    const attempt = await prisma.registrationAttempt.findFirst({
      where: { email: input.email, status: { in: ["STARTED", "EMAIL_VERIFIED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });
    if (!attempt || attempt.emailVerifiedAt) {
      return successResponse({ message: "If the email is registered, a new verification link has been sent." }, 202);
    }
    const token = createOpaqueToken();
    await prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { registrationAttemptId: attempt.id },
        data: { consumedAt: new Date() },
      });
      await tx.emailVerificationToken.create({
        data: {
          registrationAttemptId: attempt.id,
          tokenHash: hashSecret(token),
          expiresAt: new Date(Date.now() + REGISTRATION_LIFETIME_MS),
          requestIp: ip,
          userAgent: userAgent ?? null,
        },
      });
    });
    await sendRegistrationVerificationEmail(attempt.email, getVerificationUrl(token), attempt.name ?? undefined);
    return successResponse({ message: "A new verification email has been sent." }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}

