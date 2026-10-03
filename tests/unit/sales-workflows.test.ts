import { COMPANY_PERMISSION_KEYS, OWNER_PERMISSIONS } from "@/lib/company-permissions";
import { calculateGstAmounts } from "@/lib/sales/sales-service";
import {
  salesConvertSchema,
  salesDocumentCreateSchema,
  salesListQuerySchema,
} from "@/lib/validation/sales";

describe("sales workflows", () => {
  it("splits intra-state GST precisely and classifies UTGST and interstate GST", () => {
    expect(calculateGstAmounts("1.00", "5", "27", "27")).toEqual({
      cgst: "0.02", sgst: "0.03", utgst: "0.00", igst: "0.00",
    });
    expect(calculateGstAmounts("100.00", "18", "04", "04")).toEqual({
      cgst: "9.00", sgst: "0.00", utgst: "9.00", igst: "0.00",
    });
    expect(calculateGstAmounts("100.00", "18", "27", "29")).toEqual({
      cgst: "0.00", sgst: "0.00", utgst: "0.00", igst: "18.00",
    });
  });

  it("validates sales drafts and requires cash settlement account selection", () => {
    const draft = salesDocumentCreateSchema.safeParse({
      documentType: "QUOTATION",
      partyId: "party-1",
      documentDate: "2026-04-01",
      lines: [{
        itemId: "item-1", description: "Product", unit: "EA", quantity: "2",
        unitRate: "100", discountPercent: "5", warehouseId: "warehouse-1", batchNumber: "",
      }],
    });
    expect(draft.success).toBe(true);
    expect(salesConvertSchema.safeParse({
      documentType: "SALES_INVOICE",
      documentDate: "2026-04-01",
      paymentMode: "CASH",
      lines: [{ sourceLineId: "line-1", quantity: "1" }],
    }).success).toBe(false);
    expect(salesConvertSchema.safeParse({
      documentType: "SALES_INVOICE",
      documentDate: "2026-04-01",
      paymentMode: "CREDIT",
      lines: [{ sourceLineId: "line-1", quantity: "1" }],
    }).success).toBe(true);
  });

  it("validates sales search filters and registers all action permissions for company Owners", () => {
    expect(salesListQuerySchema.parse({ page: "2", pageSize: "50", documentType: "SALES_INVOICE" }))
      .toMatchObject({ page: 2, pageSize: 50, documentType: "SALES_INVOICE" });
    for (const permission of [
      "sales:read", "sales:create", "sales:update", "sales:issue", "sales:post",
      "sales:cancel", "sales:send", "sales-reports:read",
    ]) {
      expect(COMPANY_PERMISSION_KEYS.has(permission)).toBe(true);
    }
    expect(OWNER_PERMISSIONS).toHaveLength(COMPANY_PERMISSION_KEYS.size);
  });
});
