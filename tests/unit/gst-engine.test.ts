import { calculateGST, gstinSchema, gstPeriodBounds, hsnSacSchema } from "@/lib/gst/engine";
import { gstAdjustmentSchema } from "@/lib/validation/gst";

describe("GST validation and calculation engine", () => {
  test("validates GSTIN structure and checksum", () => {
    expect(gstinSchema.safeParse("27aapfu0939f1zv").success).toBe(true);
    expect(gstinSchema.safeParse("27AAPFU0939F1ZA").success).toBe(false);
    expect(gstinSchema.safeParse("00AAPFU0939F1ZV").success).toBe(false);
  });

  test("validates HSN and SAC shapes", () => {
    expect(hsnSacSchema.safeParse("847130").success).toBe(true);
    expect(hsnSacSchema.safeParse("998314").success).toBe(true);
    expect(hsnSacSchema.safeParse("ABCD").success).toBe(false);
  });

  test("splits intra-state, inter-state, and Union Territory tax correctly", () => {
    expect(calculateGST({
      unitRate: "1000", quantity: "1", gstRate: "18",
      companyStateCode: "27", placeOfSupplyStateCode: "27",
    })).toMatchObject({
      taxableAmount: "1000.00", cgstAmount: "90.00", sgstAmount: "90.00",
      utgstAmount: "0.00", igstAmount: "0.00", totalAmount: "1180.00",
      supplyType: "INTRA_STATE",
    });
    expect(calculateGST({
      unitRate: "1000", quantity: "1", gstRate: "18",
      companyStateCode: "27", placeOfSupplyStateCode: "07",
    })).toMatchObject({ cgstAmount: "0.00", igstAmount: "180.00", supplyType: "INTER_STATE" });
    expect(calculateGST({
      unitRate: "100.07", quantity: "1", gstRate: "18",
      companyStateCode: "04", placeOfSupplyStateCode: "04",
    })).toMatchObject({ cgstAmount: "9.00", utgstAmount: "9.01", sgstAmount: "0.00", supplyType: "INTRA_UT" });
    expect(calculateGST({
      unitRate: "100", quantity: "1", gstRate: "18",
      companyStateCode: "34", placeOfSupplyStateCode: "34",
    })).toMatchObject({ cgstAmount: "9.00", sgstAmount: "9.00", utgstAmount: "0.00", supplyType: "INTRA_STATE" });
  });

  test("backs tax out of inclusive prices and applies cess and reverse charge", () => {
    expect(calculateGST({
      unitRate: "1180", quantity: "1", gstRate: "18", isTaxInclusive: true,
      companyStateCode: "27", placeOfSupplyStateCode: "27",
    })).toMatchObject({ taxableAmount: "1000.00", totalAmount: "1180.00" });
    expect(calculateGST({
      unitRate: "1000", quantity: "1", gstRate: "18", cessRate: "12",
      reverseCharge: true, companyStateCode: "27", placeOfSupplyStateCode: "27",
    })).toMatchObject({
      taxableAmount: "1000.00", cessAmount: "120.00", totalAmount: "1000.00",
      supplierTaxAmount: "0.00", reverseChargeTaxAmount: "300.00",
    });
  });

  test("returns exclusive calendar boundaries for a GST period", () => {
    const bounds = gstPeriodBounds("2026-04");
    expect(bounds.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(() => gstPeriodBounds("2026-13")).toThrow("YYYY-MM");
  });

  test("accepts UTGST with CGST and rejects mixed intra/inter-state adjustment tax", () => {
    const base = {
      periodKey: "2026-04",
      adjustmentType: "CREDIT_NOTE" as const,
      side: "SALES" as const,
      voucherNumber: "CN-1",
      noteNumber: "GST-CN-1",
      noteDate: "2026-04-15",
      taxableAmount: "100",
      reason: "Correction to invoice",
    };
    expect(gstAdjustmentSchema.safeParse({
      ...base, cgstAmount: "9", utgstAmount: "9",
    }).success).toBe(true);
    expect(gstAdjustmentSchema.safeParse({
      ...base, cgstAmount: "9", igstAmount: "18",
    }).success).toBe(false);
  });
});
