import {
  emailSchema,
  otpRequestSchema,
  passwordSchema,
} from "@/lib/validation/auth";

describe("authentication input validation", () => {
  it("normalizes email addresses before lookup", () => {
    expect(emailSchema.parse("  ADMIN@Example.com ")).toBe("admin@example.com");
  });

  it("requires a strong password for password reset", () => {
    expect(passwordSchema.safeParse("a short pass").success).toBe(false);
    expect(passwordSchema.safeParse("Sufficient!Pass123").success).toBe(true);
  });

  it("requires an international mobile number for OTP", () => {
    expect(otpRequestSchema.safeParse({ mobile: "+919876543210" }).success).toBe(true);
    expect(otpRequestSchema.safeParse({ mobile: "9876543210" }).success).toBe(false);
  });
});
