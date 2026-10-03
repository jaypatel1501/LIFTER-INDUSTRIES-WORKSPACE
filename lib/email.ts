import { env, requireEnv } from "@/lib/env";

type EmailSenderConfig = {
  provider: "resend" | "smtp";
  from: string;
  fromName?: string | undefined;
  server?: string | undefined;
};

export function requireEmailConfiguration() {
  const provider = env.EMAIL_PROVIDER ?? (env.RESEND_API_KEY ? "resend" : env.EMAIL_SERVER ? "smtp" : "resend");
  const from = requireEnv("EMAIL_FROM");
  return {
    provider,
    from,
    fromName: env.EMAIL_FROM_NAME,
    server: provider === "smtp" ? requireEnv("EMAIL_SERVER") : undefined,
  };
}

export async function sendPasswordResetEmail(to: string, url: string) {
  await sendMail(
    to,
    `Reset your ${env.NEXT_PUBLIC_APP_NAME} password`,
    `Use this secure link to reset your password. It expires in 30 minutes: ${url}`,
    `<p>Use this secure link to reset your password. It expires in 30 minutes.</p><p><a href="${url}">Reset password</a></p>`,
  );
}

export async function sendRegistrationVerificationEmail(to: string, url: string, name?: string) {
  await sendMail(
    to,
    `Verify your ${env.NEXT_PUBLIC_APP_NAME} account`,
    `Hi ${name ?? "there"}, use this secure link to verify your email and continue onboarding. It expires in 30 minutes: ${url}`,
    `<p>Hi ${name ?? "there"},</p><p>Use this secure link to verify your email and continue onboarding.</p><p><a href="${url}">Verify email</a></p>`,
  );
}

export async function sendCompanyInvitationEmail(
  to: string,
  companyName: string,
  url: string,
  needsPasswordSetup: boolean,
) {
  const safeCompanyName = companyName.replace(/[\u0000-\u001F\u007F<>&"]/g, "");
  const action = needsPasswordSetup
    ? `Set your password using this secure link. It expires in 30 minutes: ${url}`
    : `A company administrator invited you to ${safeCompanyName}. Your company access will be available after membership activation. Sign in at: ${url}`;
  const htmlAction = needsPasswordSetup
    ? `<p>Set your password using this secure link. It expires in 30 minutes.</p><p><a href="${url}">Set password</a></p>`
    : `<p>A company administrator invited you to ${safeCompanyName}. Your company access will be available after membership activation.</p><p><a href="${url}">Sign in</a></p>`;
  await sendMail(
    to,
    `Invitation to ${safeCompanyName} on ${env.NEXT_PUBLIC_APP_NAME}`,
    action,
    htmlAction,
  );
}

export async function sendSalesDocumentEmail(
  to: string,
  subject: string,
  text: string,
  html: string,
) {
  await sendMail(to, subject, text, html);
}

async function sendMail(to: string, subject: string, text: string, html: string) {
  const configuration: EmailSenderConfig = requireEmailConfiguration();

  if (configuration.provider === "resend") {
    const apiKey = requireEnv("RESEND_API_KEY");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: configuration.fromName ? `${configuration.fromName} <${configuration.from}>` : configuration.from,
        to: [to],
        subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      const errorDetails = await response.text();
      throw new Error(`Resend email delivery failed (${response.status}): ${errorDetails.slice(0, 500)}`);
    }
    return;
  }

  if (configuration.provider === "smtp") {
    const { SMTPClient } = await import("emailjs");
    const server = new URL(requireEnv("EMAIL_SERVER"));
    const secure = server.protocol === "smtps:";
    const client = new SMTPClient({
      host: server.hostname,
      port: Number(server.port) || (secure ? 465 : 587),
      ...(server.username ? { user: decodeURIComponent(server.username) } : {}),
      ...(server.password ? { password: decodeURIComponent(server.password) } : {}),
      ssl: secure,
      tls: !secure,
      timeout: 10_000,
    });
    try {
      await client.sendAsync({
        from: configuration.from,
        to,
        subject,
        text,
        html,
      });
    } finally {
      client.smtp.close();
    }
    return;
  }

  throw new Error(`Unsupported email provider: ${configuration.provider}`);
}
