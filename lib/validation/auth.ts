import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());

export const passwordSchema = z
  .string()
  .min(12, "Password must contain at least 12 characters")
  .max(128)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol");

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const otpRequestSchema = z.object({
  mobile: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use an international number, e.g. +919876543210"),
});

export const otpVerifySchema = otpRequestSchema.extend({
  code: z.string().regex(/^\d{6}$/),
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const resetCompleteSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
}).refine((values) => values.currentPassword !== values.newPassword, {
  path: ["newPassword"],
  message: "New password must be different from the current password",
});
