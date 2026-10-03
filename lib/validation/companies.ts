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

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const optionalDate = z.string().date().optional();
const uniqueRoleIds = z.array(z.string().cuid()).max(20).refine(
  (ids) => new Set(ids).size === ids.length,
  "A group can only be selected once",
);

export const companyUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: nullableText(180),
  gstin: z.string().trim().toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .nullable().optional().or(z.literal("")),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .nullable().optional().or(z.literal("")),
  addressLine1: nullableText(180),
  addressLine2: nullableText(180),
  city: nullableText(100),
  state: nullableText(100),
  stateCode: optionalText(2).refine((value) => !value || /^[0-9]{2}$/.test(value)),
  postalCode: optionalText(12),
  country: z.string().trim().min(2).max(80),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  phone: optionalText(24),
  website: z.union([z.string().trim().url().max(255), z.literal("")]).optional(),
  timezone: z.string().trim().min(1).max(80).refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Use a supported IANA time zone"),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  financialYearStartMonth: z.number().int().min(1).max(12),
  booksBeginningDate: optionalDate.nullable().or(z.literal("")),
});

export const financialYearSchema = z.object({
  name: z.string().trim().min(4).max(30),
  startDate: z.string().date(),
  endDate: z.string().date(),
  booksBeginningDate: z.string().date(),
}).refine((value) =>
  value.startDate < value.endDate &&
  value.startDate <= value.booksBeginningDate &&
  value.booksBeginningDate <= value.endDate,
{
  message: "Dates must be in order and books must begin within the financial year",
  path: ["booksBeginningDate"],
});

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
});

export const memberInviteSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  mobile: z.string().trim().regex(/^\+[1-9]\d{7,14}$/).optional().or(z.literal("")),
  roleIds: uniqueRoleIds.optional(),
});

export const memberUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "INVITED"]).optional(),
  roleIds: uniqueRoleIds.optional(),
}).refine((value) => value.status !== undefined || value.roleIds !== undefined);

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: nullableText(240),
  permissions: z.array(z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/)).max(100),
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
