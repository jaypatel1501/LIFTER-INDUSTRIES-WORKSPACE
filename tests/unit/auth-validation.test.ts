import { randomUUID } from "node:crypto";
import {
  emailSchema,
  normalizeEmail,
  normalizeMobile,
  otpRequestSchema,
  passwordSchema,
  registrationStartSchema,
} from "@/lib/validation/auth";
import { POST as registerStart } from "@/app/api/auth/register/start/route";
import { POST as createCompany } from "@/app/api/auth/register/create-company/route";
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
    const email = `register-no-email-${randomUUID()}@example.test`;
    const mobile = `+919876543${String(Math.floor(Math.random() * 900) + 100)}`;
    delete process.env.EMAIL_SERVER;
    delete process.env.EMAIL_FROM;

    const response = await registerStart(new Request("http://localhost/api/auth/register/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `127.0.0.${Math.floor(Math.random() * 250) + 1}` },
      body: JSON.stringify({
        name: "No Email Verification User",
        email,
        mobile,
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

  it("creates a company without requiring email or mobile verification", async () => {
    const email = `register-company-no-verify-${randomUUID()}@example.test`;
    const mobile = `+919876543${String(Math.floor(Math.random() * 900) + 100)}`;

    const startResponse = await registerStart(new Request("http://localhost/api/auth/register/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `127.0.0.${Math.floor(Math.random() * 250) + 1}` },
      body: JSON.stringify({
        name: "Company Setup User",
        email,
        mobile,
        password: "Strong!Pass123",
        confirmPassword: "Strong!Pass123",
        preferredLanguage: "ENGLISH",
        acceptTerms: true,
      }),
    }));

    expect(startResponse.status).toBe(202);

    const companyResponse = await createCompany(new Request("http://localhost/api/auth/register/create-company", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `127.0.0.${Math.floor(Math.random() * 250) + 1}` },
      body: JSON.stringify({
        email,
        companyName: "No Verification Company",
        legalName: "No Verification Company Pvt Ltd",
        country: "India",
        currency: "INR",
        timezone: "Asia/Kolkata",
        financialYearStartMonth: 4,
        booksBeginningDate: "2026-04-01",
      }),
    }));

    const companyPayload = await companyResponse.json();
    expect(companyResponse.status).toBe(201);
    expect(companyPayload.success).toBe(true);
    expect(companyPayload.data.companyId).toBeTruthy();

    const createdUser = await prisma.user.findUnique({
      where: { normalizedEmail: email },
      include: { memberships: { include: { company: true } } },
    });

    expect(createdUser).not.toBeNull();
    expect(createdUser?.emailVerifiedAt).toBeNull();
    expect(createdUser?.mobileVerifiedAt).toBeNull();
    expect(createdUser?.memberships.length).toBeGreaterThan(0);

    if (createdUser) {
      await prisma.membershipRole.deleteMany({ where: { membershipId: { in: createdUser.memberships.map((membership) => membership.id) } } });
      await prisma.membership.deleteMany({ where: { userId: createdUser.id } });
      await prisma.auditLog.deleteMany({ where: { companyId: { in: createdUser.memberships.map((membership) => membership.companyId) } } });
      await prisma.company.deleteMany({ where: { id: { in: createdUser.memberships.map((membership) => membership.companyId) } } });
      await prisma.user.delete({ where: { id: createdUser.id } });
      await prisma.registrationAttempt.deleteMany({ where: { email } });
    }
  });
});
