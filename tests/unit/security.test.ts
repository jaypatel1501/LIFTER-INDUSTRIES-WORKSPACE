import {
  createCompanySwitchProof,
  createOpaqueToken,
  createOtpCode,
  hashSecret,
  verifyCompanySwitchProof,
  verifySecret,
} from "@/lib/security";
import { hashIdempotencyKey } from "@/lib/idempotency";

describe("security primitives", () => {
  it("creates high-entropy reset tokens and six-digit OTPs", () => {
    expect(createOpaqueToken()).toHaveLength(43);
    expect(createOtpCode()).toMatch(/^\d{6}$/);
  });

  it("compares keyed OTP hashes without exposing the secret", () => {
    const digest = hashSecret("123456");
    expect(verifySecret("123456", digest)).toBe(true);
    expect(verifySecret("654321", digest)).toBe(false);
  });

  it("binds short-lived company-switch proofs to an authenticated user and company", () => {
    const proof = createCompanySwitchProof({
      userId: "user-1",
      companyId: "company-1",
      ipAddress: "192.0.2.1",
      userAgent: "test browser",
    });
    expect(verifyCompanySwitchProof(proof, {
      userId: "user-1",
      companyId: "company-1",
    })?.ipAddress).toBe("192.0.2.1");
    expect(verifyCompanySwitchProof(proof, {
      userId: "user-2",
      companyId: "company-1",
    })).toBeNull();
  });

  it("requires a sufficiently long idempotency key and stores only its digest", () => {
    expect(hashIdempotencyKey("client-request-key-123")).toMatch(/^[a-f0-9]{64}$/);
    expect(() => hashIdempotencyKey("tiny")).toThrow("Idempotency-Key");
  });
});
