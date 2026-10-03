import { z } from "zod";

const optionalUrl = z.string().url().optional();
const optionalHttpsUrl = z.string().url()
  .refine((value) => value.startsWith("https://"), "URL must use HTTPS")
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
  ).optional(),
  DIRECT_URL: z.string().url().refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
  ).optional(),
  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_URL: optionalUrl,
  NEXT_PUBLIC_APP_URL: optionalUrl,
  NEXT_PUBLIC_APP_NAME: z.string().default("ERP System"),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  SMS_PROVIDER: z.enum(["twilio", "exotel", "msg91"]).optional(),
  SMS_API_KEY: z.string().min(1).optional(),
  SMS_SENDER_ID: z.string().min(1).optional(),
  SMS_API_URL: optionalHttpsUrl,
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12).max(128)
    .regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/).optional(),
  EMAIL_SERVER: z.string().url().refine(
    (value) => value.startsWith("smtp://") || value.startsWith("smtps://"),
    "EMAIL_SERVER must use smtp:// or smtps://",
  ).optional(),
  EMAIL_FROM: z.string().email().optional(),
  DEV_OTP_MODE: z.string().optional().transform((value) => value === "true").default(false),
  GST_API_BASE_URL: optionalHttpsUrl,
  GST_API_CLIENT_ID: z.string().optional(),
  GST_API_CLIENT_SECRET: z.string().optional(),
  EINVOICE_API_BASE_URL: optionalHttpsUrl,
  EINVOICE_API_CLIENT_ID: z.string().optional(),
  EINVOICE_API_CLIENT_SECRET: z.string().optional(),
  EWAYBILL_API_BASE_URL: optionalHttpsUrl,
  EWAYBILL_API_CLIENT_ID: z.string().optional(),
  EWAYBILL_API_CLIENT_SECRET: z.string().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
}).superRefine((values, context) => {
  if (values.NODE_ENV !== "test") {
    for (const key of ["DATABASE_URL", "DIRECT_URL", "AUTH_SECRET"] as const) {
      if (!values[key]) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required outside tests`,
        });
      }
    }
  }
  if (values.NODE_ENV === "production") {
    for (const key of [
      "DATABASE_URL",
      "DIRECT_URL",
      "AUTH_SECRET",
      "AUTH_URL",
      "NEXT_PUBLIC_APP_URL",
    ] as const) {
      if (!values[key]) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required in production`,
        });
      }
      for (const key of ["AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const) {
        if (values[key] && !values[key].startsWith("https://")) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} must use HTTPS in production`,
          });
        }
      }
    }
  }
  if (values.SMS_PROVIDER && (!values.SMS_API_KEY || !values.SMS_SENDER_ID || !values.SMS_API_URL)) {
    context.addIssue({
      code: "custom",
      path: ["SMS_API_URL"],
      message: "SMS_API_KEY, SMS_SENDER_ID, and SMS_API_URL are required when SMS_PROVIDER is set",
    });
  }
  for (const [urlKey, idKey, secretKey] of [
    ["GST_API_BASE_URL", "GST_API_CLIENT_ID", "GST_API_CLIENT_SECRET"],
    ["EINVOICE_API_BASE_URL", "EINVOICE_API_CLIENT_ID", "EINVOICE_API_CLIENT_SECRET"],
    ["EWAYBILL_API_BASE_URL", "EWAYBILL_API_CLIENT_ID", "EWAYBILL_API_CLIENT_SECRET"],
  ] as const) {
    const configured = [values[urlKey], values[idKey], values[secretKey]].some(Boolean);
    const complete = [values[urlKey], values[idKey], values[secretKey]].every(Boolean);
    if (configured && !complete) {
      context.addIssue({
        code: "custom",
        path: [urlKey],
        message: `${urlKey}, ${idKey}, and ${secretKey} must be configured together`,
      });
    }
  }
  if (Boolean(values.WHATSAPP_API_TOKEN) !== Boolean(values.WHATSAPP_PHONE_NUMBER_ID)) {
    context.addIssue({
      code: "custom",
      path: ["WHATSAPP_PHONE_NUMBER_ID"],
      message: "WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be configured together",
    });
  }
});

export const env = envSchema.parse(process.env);

export function requireEnv<K extends keyof typeof env>(
  key: K,
): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value as NonNullable<(typeof env)[K]>;
}
