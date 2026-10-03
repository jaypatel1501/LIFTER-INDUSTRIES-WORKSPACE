import bcrypt from "bcryptjs";
import { ConflictError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { errorResponse, successResponse } from "@/lib/api-response";
import { requestIp, requestUserAgent, readJson } from "@/lib/request";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { createOpaqueToken, hashSecret } from "@/lib/security";
import { registrationStartSchema } from "@/lib/validation/auth";
import { sendRegistrationVerificationEmail } from "@/lib/email";
import { getVerificationUrl, REGISTRATION_LIFETIME_MS } from "@/lib/registration";

export async function POST(request: Request) {
  try {
    const ip = requestIp(request);
    const userAgent = requestUserAgent(request);
    await enforceRateLimit(rateLimitKey("register-start-ip", ip), 5, 60 * 60_000);
    const input = registrationStartSchema.parse(await readJson(request));
    const email = input.email;
    const mobile = input.mobile;
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { normalizedEmail: email },
          { normalizedMobileNumber: mobile },
          { mobileNumber: mobile },
          { mobile: mobile },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("This email or mobile number is already in use.");
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const expiresAt = new Date(Date.now() + REGISTRATION_LIFETIME_MS);
    const token = createOpaqueToken();
    const registration = await prisma.$transaction(async (tx) => {
      const candidateExisting = await tx.registrationAttempt.findFirst({
        where: { email, status: { in: ["STARTED", "EMAIL_VERIFIED", "MOBILE_VERIFIED"] } },
        orderBy: { createdAt: "desc" },
      });
      const candidate = candidateExisting
        ? await tx.registrationAttempt.update({
            where: { id: candidateExisting.id },
            data: {
              name: input.name,
              mobileNumber: mobile,
              passwordHash,
              preferredLanguage: input.preferredLanguage,
              expiresAt,
              status: "STARTED",
              requestIp: ip,
            },
          })
        : await tx.registrationAttempt.create({
            data: {
              email,
              mobileNumber: mobile,
              name: input.name,
              passwordHash,
              preferredLanguage: input.preferredLanguage,
              expiresAt,
              status: "STARTED",
              requestIp: ip,
            },
          });
      await tx.emailVerificationToken.create({
        data: {
          registrationAttemptId: candidate.id,
          tokenHash: hashSecret(token),
          expiresAt,
          requestIp: ip,
          userAgent: userAgent ?? null,
        },
      });
      await tx.termsAcceptance.create({
        data: {
          registrationAttemptId: candidate.id,
          termsVersion: "v1",
          privacyVersion: "v1",
          ipAddress: ip,
          userAgent: userAgent ?? null,
        },
      });
      return candidate;
    });

    try {
      await sendRegistrationVerificationEmail(email, getVerificationUrl(token));
    } catch {
      throw new ValidationError("Email verification service is not configured for this environment.");
    }

    return successResponse({
      message: "Check your email to verify your account.",
      registrationId: registration.id,
      email,
      mobile,
    }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
