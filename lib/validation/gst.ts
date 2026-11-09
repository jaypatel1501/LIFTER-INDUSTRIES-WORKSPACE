import { z } from "zod";
import { gstinSchema, gstPeriodBounds, hsnSacSchema } from "@/lib/gst/engine";

const money = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const stateCode = z.string().regex(/^(0[1-9]|[1-2][0-9]|3[0-8])$/);

export const gstRegistrationSchema = z.object({
  gstin: gstinSchema,
  legalName: z.string().trim().min(1).max(200),
  tradeName: z.string().trim().max(200).optional().or(z.literal("")),
  stateCode,
  registrationType: z.enum(["REGULAR", "COMPOSITION", "SEZ", "ISD", "TDS", "TCS", "UNREGISTERED"]),
  effectiveFrom: z.iso.date(),
  filingFrequency: z.enum(["MONTHLY", "QUARTERLY"]).default("MONTHLY"),
  adapterMode: z.enum(["SANDBOX", "LIVE"]).default("SANDBOX"),
  isActive: z.boolean().default(true),
}).refine((value) => value.gstin.startsWith(value.stateCode), {
  message: "GSTIN state code must match the registration state",
  path: ["stateCode"],
});

export const gstPeriodSchema = z.object({
  periodKey: period,
  action: z.enum(["LOCK", "UNLOCK"]),
  reason: z.string().trim().min(5).max(500),
});

export const gstAdjustmentSchema = z.object({
  periodKey: period,
  adjustmentType: z.enum(["CREDIT_NOTE", "DEBIT_NOTE"]),
  side: z.enum(["SALES", "PURCHASE"]),
  voucherNumber: z.string().trim().min(1).max(64),
  noteNumber: z.string().trim().min(1).max(100),
  noteDate: z.iso.date(),
  counterpartyGstin: gstinSchema.optional().or(z.literal("")),
  taxableAmount: money,
  cgstAmount: money.default("0"),
  sgstAmount: money.default("0"),
  utgstAmount: money.default("0"),
  igstAmount: money.default("0"),
  cessAmount: money.default("0"),
  reason: z.string().trim().min(5).max(500),
}).superRefine((value, context) => {
  const totalTax = ["cgstAmount", "sgstAmount", "utgstAmount", "igstAmount", "cessAmount"]
    .reduce((sum, key) => sum + Number(value[key as keyof typeof value]), 0);
  if (totalTax === 0 && Number(value.taxableAmount) === 0) {
    context.addIssue({ code: "custom", path: ["taxableAmount"], message: "Adjustment must have a taxable amount or tax amount" });
  }
  const hasIntraStateTax = Number(value.cgstAmount) > 0 ||
    Number(value.sgstAmount) > 0 || Number(value.utgstAmount) > 0;
  if (Number(value.igstAmount) > 0 && hasIntraStateTax) {
    context.addIssue({ code: "custom", path: ["igstAmount"], message: "Intra-state and inter-state tax components cannot be mixed" });
  }
  if (Number(value.sgstAmount) > 0 && Number(value.utgstAmount) > 0) {
    context.addIssue({ code: "custom", path: ["utgstAmount"], message: "SGST and UTGST cannot be charged together" });
  }
  try {
    gstPeriodBounds(value.periodKey);
  } catch {
    context.addIssue({ code: "custom", path: ["periodKey"], message: "GST period must be in YYYY-MM format" });
  }
});

export const gstReportQuerySchema = z.object({
  periodKey: period,
  report: z.enum(["SALES_REGISTER", "PURCHASE_REGISTER", "GSTR1", "GSTR3B", "GST_LEDGER", "MISMATCHES"]),
  format: z.enum(["json", "csv"]).default("json"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
});

export const gstCalculationSchema = z.object({
  unitRate: money,
  quantity: z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/).refine((value) => Number(value) > 0),
  gstRate: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).refine((value) => Number(value) <= 100),
  cessRate: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).refine((value) => Number(value) <= 100).default("0"),
  discountPercent: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).refine((value) => Number(value) <= 100).default("0"),
  isTaxInclusive: z.boolean().default(false),
  reverseCharge: z.boolean().default(false),
  placeOfSupplyStateCode: stateCode,
});

export const hsnSacValidationSchema = z.object({
  code: hsnSacSchema,
  kind: z.enum(["HSN", "SAC"]),
}).superRefine((value, context) => {
  if (value.kind === "SAC" && !/^99\d{4}$/.test(value.code)) {
    context.addIssue({ code: "custom", path: ["code"], message: "SAC must be six digits and begin with 99" });
  }
  if (value.kind === "HSN" && value.code.startsWith("99") && value.code.length === 6) {
    context.addIssue({ code: "custom", path: ["kind"], message: "A six-digit 99 code is a SAC, not an HSN" });
  }
});

export function getGSTPeriodBounds(periodKey: string) {
  return gstPeriodBounds(periodKey);
}
