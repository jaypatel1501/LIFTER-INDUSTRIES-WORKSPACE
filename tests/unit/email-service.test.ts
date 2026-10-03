describe("email service configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email_123" }),
    }) as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("sends verification emails through the Resend API when configured", async () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/erp";
    process.env.DIRECT_URL = "postgresql://user:pass@localhost:5432/erp";
    process.env.AUTH_SECRET = "abcdefghijklmnopqrstuvwxyz123456";
    process.env.AUTH_URL = "https://app.example.com";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    process.env.EMAIL_PROVIDER = "resend";
    process.env.EMAIL_FROM = "noreply@example.com";
    process.env.EMAIL_FROM_NAME = "Lifter Industries";
    process.env.RESEND_API_KEY = "re_test_key";

    const { sendRegistrationVerificationEmail } = await import("@/lib/email");

    await sendRegistrationVerificationEmail(
      "user@example.com",
      "https://app.example.com/register/verify-email?token=test-token",
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
          "Content-Type": "application/json",
        }),
      }),
    );

    const requestBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string);
    expect(requestBody.to).toEqual(["user@example.com"]);
    expect(requestBody.subject).toContain("Verify your");
  });
});
