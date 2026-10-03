import { z } from "zod";

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeMobile(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (!compact) return compact;
  const digitsOnly = compact.replace(/[^\d+]/g, "");
  if (!digitsOnly.startsWith("+")) {
    return `+${digitsOnly.replace(/^0+/, "")}`;
  }
  return digitsOnly;
}

export function isStrongPassword(value: string) {
  return value.length >= 12
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

export const emailSchema = z
  .string()
  .trim()
  .transform(normalizeEmail)
  .pipe(z.string().email().max(254));

export const passwordSchema = z
  .string()
  .min(12, "Password must contain at least 12 characters")
  .max(128)
  .refine(isStrongPassword, "Password must include uppercase, lowercase, a number and a symbol");

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const otpRequestSchema = z.object({
  mobile: z.string().trim().refine((value) => /^\+[1-9]\d{7,14}$/.test(value), "Use an international number, e.g. +919876543210"),
});

export const otpVerifySchema = otpRequestSchema.extend({
  code: z.string().regex(/^\d{6}$/),
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const resetCompleteSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
});

export const preferredLanguageSchema = z.enum(["ENGLISH", "HINDI", "BILINGUAL"]);

export const registrationStartSchema = z.object({
  name: z.string().trim().min(2, "Full name is required").max(120),
  email: emailSchema,
  mobile: z.string().trim().transform(normalizeMobile).refine((value) => /^\+[1-9]\d{7,14}$/.test(value), "Use a valid Indian mobile number, e.g. +919876543210"),
  password: passwordSchema,
  confirmPassword: z.string().min(1),
  preferredLanguage: preferredLanguageSchema,
  acceptTerms: z.boolean().refine((value) => value === true, "You must accept the terms and privacy policy"),
}).refine((values) => values.password === values.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
}).refine((values) => values.currentPassword !== values.newPassword, {
  path: ["newPassword"],
  message: "New password must be different from the current password",
});
