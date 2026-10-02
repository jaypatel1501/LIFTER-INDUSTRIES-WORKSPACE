import { z } from "zod";

export const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(180).optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .optional()
    .or(z.literal("")),
});

export const companyListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    activeCompanyId: z.string().nullable(),
    companies: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        currency: z.string(),
      }),
    ),
  }),
});
