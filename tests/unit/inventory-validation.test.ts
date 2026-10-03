import {
  inventoryOpeningStockSchema,
  inventoryListQuerySchema,
  stockGroupCreateSchema,
  stockItemCreateSchema,
  unitConversionCreateSchema,
  warehouseCreateSchema,
} from "@/lib/validation/inventory";
import { COMPANY_PERMISSION_KEYS, OWNER_PERMISSIONS } from "@/lib/company-permissions";

describe("inventory master validation", () => {
  it("validates stock identifiers, GST, prices, thresholds, units and opening date", () => {
    const valid = stockItemCreateSchema.safeParse({
      name: "Organic Wheat",
      code: "WHEAT-01",
      groupId: "group-1",
      baseUnitId: "unit-kg",
      hsnSac: "100199",
      gstRate: "5.00",
      purchaseRate: "40.2500",
      salesRate: "55.0000",
      mrp: "60",
      minimumLevel: "5",
      reorderLevel: "10",
      maximumLevel: "50",
      batchTracked: true,
      alternateUnits: [{ unitId: "unit-g", baseQuantity: "0.001", barcode: "8901234567890" }],
      openingStock: [{
        warehouseId: "warehouse-1", quantity: "10", unitCost: "40.25",
        batchNumber: "BATCH-1", manufacturingDate: "2026-03-01", expiryDate: "2027-03-01",
      }],
      openingDate: "2026-04-01",
    });
    expect(valid.success).toBe(true);
    expect(stockItemCreateSchema.safeParse({
      name: "Invalid GST", groupId: "group-1", baseUnitId: "unit-1",
      gstRate: "101", purchaseRate: "10", salesRate: "10",
    }).success).toBe(false);
  });

  it("requires valid opening dates and batch details when applicable", () => {
    expect(inventoryOpeningStockSchema.safeParse({
      warehouseId: "warehouse-1", quantity: "1", unitCost: "10",
      manufacturingDate: "2027-03-01", expiryDate: "2026-03-01",
    }).success).toBe(false);
    const missingBatch = stockItemCreateSchema.safeParse({
      name: "Tracked item", groupId: "group-1", baseUnitId: "unit-1",
      gstRate: "0", purchaseRate: "10", salesRate: "12", batchTracked: true,
      openingStock: [{ warehouseId: "warehouse-1", quantity: "2", unitCost: "10" }],
      openingDate: "2026-04-01",
    });
    expect(missingBatch.success).toBe(false);
    const missingOpeningDate = stockItemCreateSchema.safeParse({
      name: "Opening item", groupId: "group-1", baseUnitId: "unit-1",
      gstRate: "0", purchaseRate: "10", salesRate: "12",
      openingStock: [{ warehouseId: "warehouse-1", quantity: "2", unitCost: "10" }],
    });
    expect(missingOpeningDate.success).toBe(false);
  });

  it("prevents invalid hierarchy identifiers, self-conversions and inconsistent stock thresholds", () => {
    expect(stockGroupCreateSchema.safeParse({ name: "Raw Materials", code: "RAW", parentId: "group-1" }).success).toBe(true);
    expect(warehouseCreateSchema.safeParse({ name: "Main Warehouse", code: "MAIN", parentId: null }).success).toBe(true);
    expect(unitConversionCreateSchema.safeParse({ fromUnitId: "same", toUnitId: "same", factor: "1000" }).success).toBe(false);
    expect(stockItemCreateSchema.safeParse({
      name: "Bad levels", groupId: "group-1", baseUnitId: "unit-1",
      gstRate: "0", purchaseRate: "10", salesRate: "12",
      minimumLevel: "20", reorderLevel: "10", maximumLevel: "30",
    }).success).toBe(false);
  });

  it("parses explicit false values in list filters as false", () => {
    expect(inventoryListQuerySchema.parse({ lowStock: "false", batchTracked: "false" })).toMatchObject({
      lowStock: false,
      batchTracked: false,
    });
  });

  it("grants inventory actions to the Owner role for both existing and new companies", () => {
    for (const permission of [
      "inventory:read", "inventory:create", "inventory:update", "stock-groups:manage",
      "units:manage", "warehouses:manage", "inventory-movements:read",
    ]) {
      expect(COMPANY_PERMISSION_KEYS.has(permission)).toBe(true);
    }
    expect(OWNER_PERMISSIONS).toHaveLength(COMPANY_PERMISSION_KEYS.size);
  });
});
