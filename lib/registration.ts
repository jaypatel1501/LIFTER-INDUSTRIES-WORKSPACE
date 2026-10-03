import { env } from "@/lib/env";
import { createOpaqueToken, hashSecret } from "@/lib/security";

export const REGISTRATION_LIFETIME_MS = 30 * 60_000;
export const OTP_LIFETIME_MS = 15 * 60_000;

export function getApplicationBaseUrl() {
  return (env.NEXT_PUBLIC_APP_URL ?? env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function getVerificationUrl(token: string) {
  return `${getApplicationBaseUrl()}/register/verify-email?token=${encodeURIComponent(token)}`;
}

export function createRegistrationToken() {
  return createOpaqueToken();
}

export function hashRegistrationToken(token: string) {
  return hashSecret(token);
}

export function normalizeRegistrationStatus(status: string | null | undefined) {
  const key = (status ?? "").toUpperCase();
  if (key === "STARTED" || key === "EMAIL_VERIFIED" || key === "MOBILE_VERIFIED" || key === "COMPLETED" || key === "EXPIRED" || key === "CANCELLED") {
    return key;
  }
  return "STARTED";
}

export function isDevelopmentOtpEnabled() {
  return env.NODE_ENV !== "production" && env.DEV_OTP_MODE === true;
}
