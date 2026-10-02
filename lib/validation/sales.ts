import { z } from "zod";

const amount = z.string().regex(/^\d{1,12}(?:\.\d{1,4})?$/);
const money = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/);
const quantity = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/)
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero");
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const salesLineInputSchema = z.object({
  sourceLineId: z.string().min(1).max(64).optional(),
  itemId: z.string().min(1).max(64).optional(),
  description: z.string().trim().min(1).max(240),
  unit: z.string().trim().min(1).max(24),
  quantity,
  unitRate: amount,
  gstRate: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).refine((value) => Number(value) <= 100).optional(),
  discountPercent: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).default("0")
    .refine((value) => Number(value) <= 100),
  warehouseId: z.string().min(1).max(64).optional(),
  batchNumber: optionalText(80),
  manufacturingDate: z.string().date().optional().or(z.literal("")),
  expiryDate: z.string().date().optional().or(z.literal("")),
}).refine((line) => !line.manufacturingDate || !line.expiryDate || line.manufacturingDate <= line.expiryDate, {
  message: "Manufacturing date cannot be after expiry date",
  path: ["expiryDate"],
});

export const salesDocumentCreateSchema = z.object({
  documentType: z.enum(["QUOTATION", "SALES_ORDER"]),
  partyId: z.string().min(1).max(64),
  documentDate: z.string().date(),
  validUntil: z.string().date().optional(),
  notes: optionalText(1000),
  billingAddress: z.record(z.string(), z.string().max(180)).optional(),
  shippingAddress: z.record(z.string(), z.string().max(180)).optional(),
  freight: money.default("0"),
  otherCharges: money.default("0"),
  roundOff: z.string().regex(/^-?\d{1,8}(?:\.\d{1,2})?$/).default("0"),
  lines: z.array(salesLineInputSchema).min(1).max(100),
}).refine((document) => document.documentType !== "SALES_ORDER" || document.lines.length > 0);

export const salesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  documentType: z.enum(["QUOTATION", "SALES_ORDER", "DELIVERY_NOTE", "SALES_INVOICE"]).optional(),
  status: z.enum([
    "DRAFT", "ISSUED", "ACCEPTED", "REJECTED", "PARTIALLY_DELIVERED", "DELIVERED",
    "PARTIALLY_INVOICED", "INVOICED", "POSTED", "CANCELLED", "REVERSED",
  ]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const salesTransitionSchema = z.object({
  action: z.enum(["ISSUE", "ACCEPT", "REJECT"]),
  reason: optionalText(500),
});

export const salesConvertSchema = z.object({
  documentType: z.enum(["SALES_ORDER", "DELIVERY_NOTE", "SALES_INVOICE"]),
  documentDate: z.string().date(),
  dueDate: z.string().date().optional(),
  validUntil: z.string().date().optional(),
  paymentMode: z.enum(["CASH", "CREDIT"]).optional(),
  paymentLedgerId: z.string().min(1).max(64).optional(),
  lines: z.array(z.object({
    sourceLineId: z.string().min(1).max(64),
    quantity,
    warehouseId: z.string().min(1).max(64).optional(),
    batchNumber: optionalText(80),
  })).min(1).max(100),
}).superRefine((value, context) => {
  if (value.documentType === "SALES_INVOICE" && !value.paymentMode) {
    context.addIssue({ code: "custom", path: ["paymentMode"], message: "Choose cash or credit payment" });
  }
  if (value.documentType === "SALES_INVOICE" && value.paymentMode === "CASH" && !value.paymentLedgerId) {
    context.addIssue({ code: "custom", path: ["paymentLedgerId"], message: "Select a cash or bank ledger" });
  }
});

export const salesPostSchema = z.object({
  paymentMode: z.enum(["CASH", "CREDIT"]),
  dueDate: z.string().date().optional(),
  paymentLedgerId: z.string().min(1).max(64).optional(),
}).superRefine((value, context) => {
  if (value.paymentMode === "CASH" && !value.paymentLedgerId) {
    context.addIssue({ code: "custom", path: ["paymentLedgerId"], message: "Select a cash or bank ledger" });
  }
});

export const salesCancelSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  reversalDate: z.string().date(),
});
