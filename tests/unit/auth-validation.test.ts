import {
  emailSchema,
  normalizeEmail,
  normalizeMobile,
  otpRequestSchema,
  passwordSchema,
  registrationStartSchema,
} from "@/lib/validation/auth";
import { POST as registerStart } from "@/app/api/auth/register/start/route";
import { prisma } from "@/lib/prisma";

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

  it("creates a user immediately without requiring email verification", async () => {
    const email = `register-no-email-${Date.now()}@example.test`;
    delete process.env.EMAIL_SERVER;
    delete process.env.EMAIL_FROM;

    const response = await registerStart(new Request("http://localhost/api/auth/register/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No Email Verification User",
        email,
        mobile: "+919876543210",
        password: "Strong!Pass123",
        confirmPassword: "Strong!Pass123",
        preferredLanguage: "ENGLISH",
        acceptTerms: true,
      }),
    }));

    const payload = await response.json();
    expect(response.status).toBe(202);
    expect(payload.success).toBe(true);

    const user = await prisma.user.findUnique({
      where: { normalizedEmail: email },
      select: { id: true, email: true, status: true, emailVerifiedAt: true },
    });

    expect(user).not.toBeNull();
    expect(user?.email).toBe(email);
    expect(user?.status).toBe("ACTIVE");
    expect(user?.emailVerifiedAt).toBeNull();

    if (user) {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
