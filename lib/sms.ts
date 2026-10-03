import { env, requireEnv } from "@/lib/env";

export interface SmsAdapter {
  send(to: string, message: string): Promise<void>;
}

class HttpSmsAdapter implements SmsAdapter {
  constructor(private readonly provider: string) {}

  async send(to: string, message: string) {
    const endpoint = requireEnv("SMS_API_URL");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("SMS_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: this.provider,
        from: requireEnv("SMS_SENDER_ID"),
        to,
        message,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`SMS provider request failed with status ${response.status}`);
    }
  }
}

export function createSmsAdapter(): SmsAdapter {
  const provider = env.SMS_PROVIDER;
  if (!provider) throw new Error("SMS_PROVIDER is required to send OTP messages");
  return new HttpSmsAdapter(provider);
}

export function otpMessage(code: string) {
  return `Your ERP System verification code is ${code}. It expires in 15 minutes.`;
}
