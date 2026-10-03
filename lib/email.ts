import { SMTPClient } from "emailjs";
import { requireEnv } from "@/lib/env";

export function requireEmailConfiguration() {
  return {
    server: requireEnv("EMAIL_SERVER"),
    from: requireEnv("EMAIL_FROM"),
  };
}

export async function sendPasswordResetEmail(to: string, url: string) {
  await sendMail(
    to,
    "Reset your ERP System password",
    `Use this secure link to reset your password. It expires in 30 minutes: ${url}`,
    `<p>Use this secure link to reset your password. It expires in 30 minutes.</p><p><a href="${url}">Reset password</a></p>`,
  );
}

export async function sendRegistrationVerificationEmail(to: string, url: string) {
  await sendMail(
    to,
    "Verify your ERP System account",
    `Use this secure link to verify your email and continue onboarding. It expires in 30 minutes: ${url}`,
    `<p>Use this secure link to verify your email and continue onboarding.</p><p><a href="${url}">Verify email</a></p>`,
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
    `Invitation to ${safeCompanyName} on ERP System`,
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
  const configuration = requireEmailConfiguration();
  const server = new URL(configuration.server);
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
}
