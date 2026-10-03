import {
  emailSchema,
  normalizeEmail,
  normalizeMobile,
  otpRequestSchema,
  passwordSchema,
  registrationStartSchema,
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

  it("normalizes registration email and mobile values and rejects weak passwords", () => {
    const result = registrationStartSchema.parse({
      name: "Test User",
      email: "  TEST.USER@Example.com ",
      mobile: "+91 98765 43210",
      password: "Strong!Pass123",
      confirmPassword: "Strong!Pass123",
      preferredLanguage: "ENGLISH",
      acceptTerms: true,
    });

    expect(normalizeEmail(result.email)).toBe("test.user@example.com");
    expect(normalizeMobile(result.mobile)).toBe("+919876543210");
    expect(passwordSchema.safeParse("Weak123").success).toBe(false);
  });

  it("rejects invalid registration attempts and role escalation values", () => {
    expect(registrationStartSchema.safeParse({
      name: "",
      email: "bad-email",
      mobile: "+919876543210",
      password: "Strong!Pass123",
      confirmPassword: "Strong!Pass123",
      preferredLanguage: "ENGLISH",
      acceptTerms: true,
    }).success).toBe(false);

    expect(registrationStartSchema.safeParse({
      name: "Test User",
      email: "test@example.com",
      mobile: "+919876543210",
      password: "Strong!Pass123",
      confirmPassword: "Different!Pass123",
      preferredLanguage: "ENGLISH",
      acceptTerms: true,
    }).success).toBe(false);
  });
});
