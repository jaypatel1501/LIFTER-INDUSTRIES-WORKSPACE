import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env, requireEnv } from "@/lib/env";

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function createOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashSecret(value: string) {
  return createHmac("sha256", requireEnv("AUTH_SECRET")).update(value).digest("hex");
}

export function verifySecret(value: string, expectedHash: string) {
  const actual = Buffer.from(hashSecret(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type CompanySwitchClaims = {
  userId: string;
  companyId: string;
  ipAddress: string;
  userAgent: string | null;
  expiresAt: number;
};

export function createCompanySwitchProof(
  claims: Omit<CompanySwitchClaims, "expiresAt">,
) {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, expiresAt: Date.now() + 120_000 }),
  ).toString("base64url");
  const signature = createHmac("sha256", requireEnv("AUTH_SECRET"))
    .update(`company-switch:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyCompanySwitchProof(
  proof: string,
  expected: Pick<CompanySwitchClaims, "userId" | "companyId">,
): CompanySwitchClaims | null {
  const [payload, signature] = proof.split(".");
  if (!payload || !signature) return null;
  const expectedSignature = createHmac("sha256", requireEnv("AUTH_SECRET"))
    .update(`company-switch:${payload}`)
    .digest();
  const receivedSignature = Buffer.from(signature, "base64url");
  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (
    typeof claims !== "object" ||
    claims === null ||
    !("userId" in claims) ||
    !("companyId" in claims) ||
    !("ipAddress" in claims) ||
    !("userAgent" in claims) ||
    !("expiresAt" in claims) ||
    claims.userId !== expected.userId ||
    claims.companyId !== expected.companyId ||
    typeof claims.ipAddress !== "string" ||
    (typeof claims.userAgent !== "string" && claims.userAgent !== null) ||
    typeof claims.expiresAt !== "number" ||
    claims.expiresAt <= Date.now()
  ) return null;

  return {
    userId: claims.userId,
    companyId: claims.companyId,
    ipAddress: claims.ipAddress,
    userAgent: claims.userAgent,
    expiresAt: claims.expiresAt,
  };
}

export function getPasswordResetUrl(token: string) {
  return new URL(`/reset-password?token=${encodeURIComponent(token)}`, getApplicationUrl()).toString();
}

export function getLoginUrl() {
  return new URL("/login", getApplicationUrl()).toString();
}

function getApplicationUrl() {
  const baseUrl = env.NEXT_PUBLIC_APP_URL ?? env.AUTH_URL;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_APP_URL or AUTH_URL is required");
  return baseUrl;
}
