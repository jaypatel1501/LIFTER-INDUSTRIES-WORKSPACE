jest.mock("emailjs", () => ({
  SMTPClient: jest.fn().mockImplementation(() => ({
    sendAsync: jest.fn().mockResolvedValue(undefined),
    smtp: { close: jest.fn() },
  })),
}));

describe("email service configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("reports missing SMTP variable names without exposing values", async () => {
    delete process.env.EMAIL_SERVER;
    delete process.env.EMAIL_FROM;

    const { requireEmailConfiguration } = await import("@/lib/email");

    expect(() => requireEmailConfiguration()).toThrow(
      "Email service configuration is incomplete. Set: EMAIL_SERVER, EMAIL_FROM",
    );
  });

  it("sends registration and password reset emails through the existing SMTP client", async () => {
    process.env.EMAIL_SERVER = "smtps://smtp-user:smtp-password@mail.example.test:465";
    process.env.EMAIL_FROM = "noreply@example.test";

    const { sendRegistrationVerificationEmail, sendPasswordResetEmail } = await import("@/lib/email");

    await sendRegistrationVerificationEmail("user@example.test", "https://erp.example.test/verify");
    await sendPasswordResetEmail("user@example.test", "https://erp.example.test/reset");

    const { SMTPClient } = await import("emailjs");
    expect(SMTPClient).toHaveBeenCalledTimes(2);
    const clients = (SMTPClient as jest.Mock).mock.results.map(({ value }) => value as {
      sendAsync: jest.Mock;
    });
    if (!clients[0] || !clients[1]) throw new Error("SMTP clients were not created");

    expect(clients[0].sendAsync).toHaveBeenCalledWith(
      expect.objectContaining({ from: "noreply@example.test", to: "user@example.test" }),
    );
    expect(clients[1].sendAsync).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Reset your ERP System password" }),
    );
  });
});
