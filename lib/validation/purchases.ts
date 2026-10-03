import { z } from "zod";

const money = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/);
const rate = z.string().regex(/^\d{1,12}(?:\.\d{1,4})?$/);
const quantity = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/)
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero");
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const purchaseLineInputSchema = z.object({
  itemId: z.string().min(1).max(64).optional(),
  sourceLineId: z.string().min(1).max(64).optional(),
  costCentreId: z.string().min(1).max(64).optional(),
  description: z.string().trim().min(1).max(240),
  unit: z.string().trim().min(1).max(24),
  quantity,
  unitRate: rate,
  discountPercent: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).default("0")
    .refine((value) => Number(value) <= 100),
  gstRate: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).refine((value) => Number(value) <= 100).optional(),
  warehouseId: z.string().min(1).max(64).optional(),
  batchNumber: optionalText(80),
  manufacturingDate: z.string().date().optional().or(z.literal("")),
  expiryDate: z.string().date().optional().or(z.literal("")),
}).refine((line) => !line.manufacturingDate || !line.expiryDate || line.manufacturingDate <= line.expiryDate, {
  message: "Manufacturing date cannot be after expiry date",
  path: ["expiryDate"],
});

export const purchaseDocumentCreateSchema = z.object({
  documentType: z.enum(["PURCHASE_ORDER", "PURCHASE_INVOICE"]),
  partyId: z.string().min(1).max(64),
  documentDate: z.string().date(),
  dueDate: z.string().date().optional(),
  supplierInvoiceNumber: optionalText(100),
  supplierInvoiceDate: z.string().date().optional(),
  notes: optionalText(1000),
  freight: money.default("0"),
  otherCharges: money.default("0"),
  roundOff: z.string().regex(/^-?\d{1,8}(?:\.\d{1,2})?$/).default("0"),
  paymentMode: z.enum(["CASH", "CREDIT"]).optional(),
  paymentLedgerId: z.string().min(1).max(64).optional(),
  lines: z.array(purchaseLineInputSchema).min(1).max(100),
}).superRefine((document, context) => {
  if (document.documentType === "PURCHASE_INVOICE" && !document.supplierInvoiceNumber) {
    context.addIssue({ code: "custom", path: ["supplierInvoiceNumber"], message: "Supplier invoice reference is required" });
  }
  if (document.documentType === "PURCHASE_INVOICE" && !document.supplierInvoiceDate) {
    context.addIssue({ code: "custom", path: ["supplierInvoiceDate"], message: "Supplier invoice date is required" });
  }
  if (document.paymentMode === "CASH" && !document.paymentLedgerId) {
    context.addIssue({ code: "custom", path: ["paymentLedgerId"], message: "Select a cash or bank ledger" });
  }
});

export const purchaseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  documentType: z.enum(["PURCHASE_ORDER", "RECEIPT_NOTE", "PURCHASE_INVOICE", "PURCHASE_RETURN"]).optional(),
  status: z.enum([
    "DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "PARTIALLY_INVOICED", "INVOICED", "POSTED", "CANCELLED", "REVERSED",
  ]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const purchaseConvertSchema = z.object({
  documentType: z.enum(["RECEIPT_NOTE", "PURCHASE_INVOICE", "PURCHASE_RETURN"]),
  documentDate: z.string().date(),
  dueDate: z.string().date().optional(),
  supplierInvoiceNumber: optionalText(100),
  supplierInvoiceDate: z.string().date().optional(),
  paymentMode: z.enum(["CASH", "CREDIT"]).optional(),
  paymentLedgerId: z.string().min(1).max(64).optional(),
  lines: z.array(z.object({
    sourceLineId: z.string().min(1).max(64),
    quantity,
    warehouseId: z.string().min(1).max(64).optional(),
    batchNumber: optionalText(80),
    manufacturingDate: z.string().date().optional().or(z.literal("")),
    expiryDate: z.string().date().optional().or(z.literal("")),
  })).min(1).max(100),
}).superRefine((value, context) => {
  if (value.documentType === "PURCHASE_INVOICE" && !value.supplierInvoiceNumber) {
    context.addIssue({ code: "custom", path: ["supplierInvoiceNumber"], message: "Supplier invoice reference is required" });
  }
  if (value.documentType === "PURCHASE_INVOICE" && !value.supplierInvoiceDate) {
    context.addIssue({ code: "custom", path: ["supplierInvoiceDate"], message: "Supplier invoice date is required" });
  }
  if (value.documentType === "PURCHASE_INVOICE" && value.paymentMode === "CASH" && !value.paymentLedgerId) {
    context.addIssue({ code: "custom", path: ["paymentLedgerId"], message: "Select a cash or bank ledger" });
  }
});

export const purchasePostSchema = z.object({
  paymentMode: z.enum(["CASH", "CREDIT"]),
  dueDate: z.string().date().optional(),
  paymentLedgerId: z.string().min(1).max(64).optional(),
}).superRefine((value, context) => {
  if (value.paymentMode === "CASH" && !value.paymentLedgerId) {
    context.addIssue({ code: "custom", path: ["paymentLedgerId"], message: "Select a cash or bank ledger" });
  }
});

export const purchaseCancelSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  reversalDate: z.string().date(),
});
