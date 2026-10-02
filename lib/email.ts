import { SMTPClient } from "emailjs";
import { requireEnv } from "@/lib/env";

export function requireEmailConfiguration() {
  return {
    server: requireEnv("EMAIL_SERVER"),
    from: requireEnv("EMAIL_FROM"),
  };
}

export async function sendPasswordResetEmail(to: string, url: string) {
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
      subject: "Reset your ERP System password",
      text: `Use this secure link to reset your password. It expires in 30 minutes: ${url}`,
      html: `<p>Use this secure link to reset your password. It expires in 30 minutes.</p><p><a href="${url}">Reset password</a></p>`,
    });
  } finally {
    client.smtp.close();
  }
}
