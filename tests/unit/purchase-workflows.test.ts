import { COMPANY_PERMISSION_KEYS, OWNER_PERMISSIONS } from "@/lib/company-permissions";
import { purchaseDocumentCreateSchema, purchaseConvertSchema, purchaseListQuerySchema, purchasePostSchema } from "@/lib/validation/purchases";

describe("purchase workflows", () => {
  const serviceLine = { description: "Freight service", unit: "JOB", quantity: "1", unitRate: "100", gstRate: "18" };

  it("validates supplier orders and requires supplier references for invoices", () => {
    expect(purchaseDocumentCreateSchema.safeParse({ documentType: "PURCHASE_ORDER", partyId: "supplier-1", documentDate: "2026-04-01", lines: [serviceLine] }).success).toBe(true);
    expect(purchaseDocumentCreateSchema.safeParse({ documentType: "PURCHASE_INVOICE", partyId: "supplier-1", documentDate: "2026-04-01", lines: [serviceLine] }).success).toBe(false);
    expect(purchaseDocumentCreateSchema.safeParse({ documentType: "PURCHASE_INVOICE", partyId: "supplier-1", documentDate: "2026-04-01", supplierInvoiceNumber: "SUP-88", supplierInvoiceDate: "2026-04-01", lines: [serviceLine] }).success).toBe(true);
  });

  it("requires cash settlement ledgers and validates conversion quantities", () => {
    expect(purchasePostSchema.safeParse({ paymentMode: "CASH" }).success).toBe(false);
    expect(purchasePostSchema.safeParse({ paymentMode: "CASH", paymentLedgerId: "cash-1" }).success).toBe(true);
    expect(purchaseConvertSchema.safeParse({ documentType: "RECEIPT_NOTE", documentDate: "2026-04-01", lines: [{ sourceLineId: "line-1", quantity: "0" }] }).success).toBe(false);
  });

  it("supports paginated supplier-reference search and registers Owner permissions", () => {
    expect(purchaseListQuerySchema.parse({ page: "2", pageSize: "50", documentType: "PURCHASE_INVOICE" }))
      .toMatchObject({ page: 2, pageSize: 50, documentType: "PURCHASE_INVOICE" });
    for (const permission of ["purchases:read", "purchases:create", "purchases:issue", "purchases:post", "purchases:cancel", "purchase-reports:read"]) {
      expect(COMPANY_PERMISSION_KEYS.has(permission)).toBe(true);
    }
    expect(OWNER_PERMISSIONS).toHaveLength(COMPANY_PERMISSION_KEYS.size);
  });
});
