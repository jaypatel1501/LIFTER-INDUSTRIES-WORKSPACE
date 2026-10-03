import { z } from "zod";
import { VoucherType } from "@prisma/client";

const money = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);
const toCents = (value: string) => {
  const [units, fraction = ""] = value.split(".");
  return BigInt(units!) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
};
const quantity = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/).refine((value) => Number(value) > 0);
const unitCost = z.string().regex(/^\d{1,12}(?:\.\d{1,4})?$/);
const date = z.string().date();
const text = (maximum: number) => z.string().trim().max(maximum).optional().or(z.literal(""));

const taxSchema = z.object({
  taxLedgerId: z.string().min(1).max(64),
  taxType: z.enum(["CGST", "SGST", "UTGST", "IGST", "CESS", "TDS", "TCS", "OTHER"]),
  taxableAmount: money,
  taxAmount: money,
  rate: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).refine((value) => Number(value) <= 100),
});

const billSchema = z.object({
  referenceType: z.enum(["NEW", "AGAINST_REF", "ON_ACCOUNT"]),
  referenceNumber: text(100),
  billEntryId: z.string().min(1).max(64).optional(),
  openingBillId: z.string().min(1).max(64).optional(),
  dueDate: date.optional().or(z.literal("")),
  amount: money.refine((value) => Number(value) > 0),
}).superRefine((bill, context) => {
  if (bill.referenceType === "ON_ACCOUNT" && bill.referenceNumber) {
    context.addIssue({ code: "custom", path: ["referenceNumber"], message: "On-account entries cannot have a reference number" });
  }
  if (bill.referenceType !== "ON_ACCOUNT" && !bill.referenceNumber) {
    context.addIssue({ code: "custom", path: ["referenceNumber"], message: "A reference number is required" });
  }
  if (bill.referenceType === "AGAINST_REF" && Boolean(bill.billEntryId) === Boolean(bill.openingBillId)) {
    context.addIssue({ code: "custom", path: ["billEntryId"], message: "Select exactly one open invoice or opening bill to settle" });
  }
  if (bill.referenceType !== "AGAINST_REF" && (bill.billEntryId || bill.openingBillId)) {
    context.addIssue({ code: "custom", path: ["billEntryId"], message: "Only against-reference entries can settle an existing bill" });
  }
});

const allocationSchema = z.object({
  costCentreId: z.string().min(1).max(64),
  amount: money.refine((value) => Number(value) > 0),
});

const stockSchema = z.object({
  itemId: z.string().min(1).max(64),
  warehouseId: z.string().min(1).max(64),
  batchNumber: text(80),
  manufacturingDate: date.optional().or(z.literal("")),
  expiryDate: date.optional().or(z.literal("")),
  movementType: z.enum(["OPENING", "PURCHASE", "SALES", "SALES_RETURN", "PURCHASE_RETURN", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT", "PRODUCTION_IN", "PRODUCTION_OUT", "JOB_WORK_IN", "JOB_WORK_OUT"]),
  direction: z.enum(["IN", "OUT"]),
  quantity,
  unitCost,
}).refine((value) => !value.manufacturingDate || !value.expiryDate || value.manufacturingDate <= value.expiryDate, {
  message: "Manufacturing date cannot be after expiry date",
  path: ["expiryDate"],
}).superRefine((value, context) => {
  const requiredDirection: Partial<Record<typeof value.movementType, typeof value.direction>> = {
    OPENING: "IN",
    PURCHASE: "IN",
    SALES: "OUT",
    SALES_RETURN: "IN",
    PURCHASE_RETURN: "OUT",
    TRANSFER_IN: "IN",
    TRANSFER_OUT: "OUT",
    PRODUCTION_IN: "IN",
    PRODUCTION_OUT: "OUT",
    JOB_WORK_IN: "IN",
    JOB_WORK_OUT: "OUT",
  };
  if (requiredDirection[value.movementType] && requiredDirection[value.movementType] !== value.direction) {
    context.addIssue({ code: "custom", path: ["direction"], message: "Movement direction does not match the movement type" });
  }
});

const attachmentSchema = z.object({
  objectKey: z.string().trim().min(1).max(500),
  url: z.string().url().refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" &&
        (parsed.hostname === "blob.vercel-storage.com" || parsed.hostname.endsWith(".blob.vercel-storage.com"));
    } catch {
      return false;
    }
  }, "Attachment must use a secure Vercel Blob URL"),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
});

export const voucherLineSchema = z.object({
  ledgerId: z.string().min(1).max(64),
  description: text(240),
  debit: money,
  credit: money,
  bills: z.array(billSchema).max(50).default([]),
  taxes: z.array(taxSchema).max(10).default([]),
  costAllocations: z.array(allocationSchema).max(50).default([]),
  stock: stockSchema.optional(),
}).superRefine((line, context) => {
  const debit = Number(line.debit);
  const credit = Number(line.credit);
  if (debit > 0 && credit > 0) {
    context.addIssue({ code: "custom", path: ["credit"], message: "A voucher line cannot contain both debit and credit" });
  }
  const lineAmount = toCents(debit >= credit ? line.debit : line.credit);
  if (line.bills.length && line.bills.reduce((total, bill) => total + toCents(bill.amount), BigInt(0)) > lineAmount) {
    context.addIssue({ code: "custom", path: ["bills"], message: "Bill-wise amounts cannot exceed the line amount" });
  }
  if (line.costAllocations.length && line.costAllocations.reduce((total, allocation) => total + toCents(allocation.amount), BigInt(0)) > lineAmount) {
    context.addIssue({ code: "custom", path: ["costAllocations"], message: "Cost allocations cannot exceed the line amount" });
  }
  if (new Set(line.taxes.map(({ taxType }) => taxType)).size !== line.taxes.length) {
    context.addIssue({ code: "custom", path: ["taxes"], message: "Each tax type can only be entered once per voucher line" });
  }
});

export const voucherDraftSchema = z.object({
  type: z.nativeEnum(VoucherType),
  voucherDate: date,
  narration: text(500),
  paymentMethod: z.enum(["CASH", "BANK", "CHEQUE", "UPI", "NEFT", "RTGS"]).optional(),
  paymentReference: text(120),
  paymentDate: date.optional().or(z.literal("")),
  paymentBank: text(120),
  lines: z.array(voucherLineSchema).min(2).max(100),
  attachments: z.array(attachmentSchema).max(20).default([]),
}).superRefine((voucher, context) => {
  const referenceRequired = ["CHEQUE", "UPI", "NEFT", "RTGS"].includes(voucher.paymentMethod ?? "");
  if (referenceRequired && !voucher.paymentReference) {
    context.addIssue({ code: "custom", path: ["paymentReference"], message: "A payment reference is required for this payment method" });
  }
  if (referenceRequired && !voucher.paymentDate) {
    context.addIssue({ code: "custom", path: ["paymentDate"], message: "An instrument date is required for this payment method" });
  }
  if (voucher.paymentMethod && !["PAYMENT", "RECEIPT", "CONTRA"].includes(voucher.type)) {
    context.addIssue({ code: "custom", path: ["paymentMethod"], message: "Payment methods are only available for payment, receipt and contra vouchers" });
  }
  if (voucher.paymentReference && !voucher.paymentMethod) {
    context.addIssue({ code: "custom", path: ["paymentMethod"], message: "Select a payment method for this reference" });
  }
});

export const voucherListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  type: z.nativeEnum(VoucherType).optional(),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED", "REVERSED"]).optional(),
  from: date.optional(),
  to: date.optional(),
});

export const voucherApprovalSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: text(500),
});

export const voucherNumberSeriesSchema = z.object({
  voucherType: z.nativeEnum(VoucherType),
  financialYearId: z.string().min(1).max(64).nullable().optional(),
  prefix: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9/-]+$/),
  suffix: z.string().trim().max(16).regex(/^[A-Za-z0-9/-]*$/).optional(),
  nextNumber: z.number().int().min(1).max(2_000_000_000).optional(),
  padding: z.number().int().min(1).max(12).default(5),
  requiresApproval: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const voucherNumberSeriesUpdateSchema = voucherNumberSeriesSchema
  .omit({ voucherType: true, financialYearId: true })
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined));
