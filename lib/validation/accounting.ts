import { z } from "zod";

const positiveAmount = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);
const toMinorUnits = (value: string) => {
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) return BigInt(-1);
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
};
const billAmount = positiveAmount.refine(
  (value) => /^\d{1,16}(?:\.\d{1,2})?$/.test(value) && toMinorUnits(value) > BigInt(0),
  "Bill amount must be greater than zero",
);
const interestRate = z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/)
  .refine((value) => Number(value) <= 100, "Interest rate cannot exceed 100%");
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const pan = z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional().or(z.literal(""));
const gstin = z.string().trim().toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
  .optional().or(z.literal(""));

export const openingBalanceSchema = z.object({
  amount: positiveAmount,
  side: z.enum(["DEBIT", "CREDIT"]),
  date: z.string().date(),
  bills: z.array(z.object({
    referenceNumber: z.string().trim().min(1).max(80),
    dueDate: z.string().date(),
    amount: billAmount,
  })).max(250).default([]),
});

export const partyCreateSchema = z.object({
  type: z.enum(["CUSTOMER", "SUPPLIER"]),
  name: z.string().trim().min(2).max(160),
  contactName: optionalText(120),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  phone: optionalText(24),
  mobile: optionalText(24),
  gstin,
  pan,
  addressLine1: optionalText(180),
  addressLine2: optionalText(180),
  city: optionalText(100),
  state: optionalText(100),
  stateCode: z.string().trim().regex(/^\d{2}$/).optional().or(z.literal("")),
  postalCode: optionalText(12),
  country: z.string().trim().min(2).max(80).default("India"),
  creditPeriodDays: z.number().int().min(0).max(3650).default(0),
  creditLimit: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).default("0"),
  openingBalance: openingBalanceSchema.optional(),
}).refine((value) => {
  const bills = value.openingBalance?.bills ?? [];
  if (!bills.length) return true;
  const total = bills.reduce((sum, bill) => sum + toMinorUnits(bill.amount), BigInt(0));
  return total === toMinorUnits(value.openingBalance?.amount ?? "0");
}, { message: "Bill-wise details must equal the opening balance", path: ["openingBalance", "bills"] })
  .refine((value) => {
    const refs = (value.openingBalance?.bills ?? []).map(({ referenceNumber }) => referenceNumber.toLowerCase());
    return new Set(refs).size === refs.length;
  }, { message: "Bill reference numbers must be unique", path: ["openingBalance", "bills"] })
  .refine((value) =>
    !value.gstin || !value.stateCode || value.gstin.slice(0, 2) === value.stateCode,
  { message: "GSTIN and state code must match", path: ["stateCode"] })
  .refine((value) =>
    !value.gstin || !value.pan || value.gstin.slice(2, 12) === value.pan,
  { message: "GSTIN and PAN must match", path: ["pan"] });

export const partyUpdateSchema = z.object({
  contactName: optionalText(120),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  phone: optionalText(24),
  mobile: optionalText(24),
  gstin: gstin,
  pan,
  addressLine1: optionalText(180),
  addressLine2: optionalText(180),
  city: optionalText(100),
  state: optionalText(100),
  stateCode: z.string().trim().regex(/^\d{2}$/).optional().or(z.literal("")),
  postalCode: optionalText(12),
  country: z.string().trim().min(2).max(80).optional(),
  creditPeriodDays: z.number().int().min(0).max(3650).optional(),
  creditLimit: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.values(value).some((field) => field !== undefined));

export const ledgerCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  groupId: z.string().min(1).max(64),
  code: z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9_-]+$/).optional().or(z.literal("")),
  type: z.enum(["GENERAL", "CASH", "BANK", "TAX", "INCOME", "EXPENSE"]),
  costCentreEnabled: z.boolean().default(false),
  interestEnabled: z.boolean().default(false),
  interestRate: interestRate.optional().or(z.literal("")),
  openingBalance: openingBalanceSchema.optional(),
}).refine((value) => !value.interestEnabled || Boolean(value.interestRate), {
  message: "Interest rate is required when interest tracking is enabled",
  path: ["interestRate"],
});

export const ledgerUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  groupId: z.string().min(1).max(64).optional(),
  costCentreEnabled: z.boolean().optional(),
  interestEnabled: z.boolean().optional(),
  interestRate: interestRate.nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.values(value).some((field) => field !== undefined));

export const ledgerGroupCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9_-]+$/),
  nature: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  parentId: z.string().min(1).max(64).nullable().optional(),
});

export const ledgerGroupUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  parentId: z.string().min(1).max(64).nullable().optional(),
}).refine((value) => Object.values(value).some((field) => field !== undefined));

export const accountingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  type: z.enum(["CUSTOMER", "SUPPLIER"]).optional(),
  groupId: z.string().min(1).max(64).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});
