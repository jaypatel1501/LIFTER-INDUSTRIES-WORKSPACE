import { z } from "zod";

const positiveDecimal = (integerDigits: number, decimalPlaces: number) =>
  z.string().regex(new RegExp(`^\\d{1,${integerDigits}}(?:\\.\\d{1,${decimalPlaces}})?$`))
    .refine((value) => Number(value) > 0, "Value must be greater than zero");
const nonnegativeDecimal = (integerDigits: number, decimalPlaces: number) =>
  z.string().regex(new RegExp(`^\\d{1,${integerDigits}}(?:\\.\\d{1,${decimalPlaces}})?$`));
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

const unitConversionSchema = z.object({
  unitId: z.string().min(1).max(64),
  baseQuantity: positiveDecimal(10, 8),
  barcode: optionalText(80),
});

export const inventoryOpeningStockSchema = z.object({
  warehouseId: z.string().min(1).max(64),
  quantity: positiveDecimal(12, 6),
  unitCost: nonnegativeDecimal(12, 4),
  batchNumber: optionalText(80),
  manufacturingDate: z.string().date().optional().or(z.literal("")),
  expiryDate: z.string().date().optional().or(z.literal("")),
}).refine((value) =>
  !value.manufacturingDate || !value.expiryDate || value.manufacturingDate <= value.expiryDate,
{ message: "Manufacturing date cannot be after expiry date", path: ["expiryDate"] });

export const stockItemCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9_-]+$/).optional().or(z.literal("")),
  groupId: z.string().min(1).max(64),
  baseUnitId: z.string().min(1).max(64),
  hsnSac: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,8}$/).optional().or(z.literal("")),
  gstRate: z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/).refine((value) => Number(value) <= 100),
  purchaseRate: nonnegativeDecimal(12, 4),
  salesRate: nonnegativeDecimal(12, 4),
  mrp: nonnegativeDecimal(12, 4).optional().or(z.literal("")),
  reorderLevel: nonnegativeDecimal(12, 6).default("0"),
  minimumLevel: nonnegativeDecimal(12, 6).default("0"),
  maximumLevel: nonnegativeDecimal(12, 6).optional().or(z.literal("")),
  batchTracked: z.boolean().default(false),
  barcode: optionalText(80),
  alternateUnits: z.array(unitConversionSchema).max(20).default([]),
  openingStock: z.array(inventoryOpeningStockSchema).max(100).default([]),
  openingDate: z.string().date().optional(),
}).refine((value) => Number(value.reorderLevel) >= Number(value.minimumLevel), {
  message: "Reorder level cannot be below minimum level",
  path: ["reorderLevel"],
}).refine((value) => !value.maximumLevel || Number(value.maximumLevel) >= Number(value.reorderLevel), {
  message: "Maximum level cannot be below reorder level",
  path: ["maximumLevel"],
}).refine((value) => {
  const units = value.alternateUnits.map((unit) => unit.unitId);
  return new Set(units).size === units.length && !units.includes(value.baseUnitId);
}, { message: "Alternate units must be unique and cannot be the base unit", path: ["alternateUnits"] })
  .refine((value) => !value.batchTracked || value.openingStock.every((row) => Boolean(row.batchNumber)), {
    message: "Batch number is required for every opening-stock line on a batch-tracked item",
    path: ["openingStock"],
  })
  .refine((value) => value.batchTracked || value.openingStock.every((row) => !row.batchNumber), {
    message: "Batch details are only allowed for batch-tracked items",
    path: ["openingStock"],
  })
  .refine((value) => value.openingStock.length === 0 || Boolean(value.openingDate), {
    message: "Opening date is required when opening stock is entered",
    path: ["openingDate"],
  });

export const stockItemUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  groupId: z.string().min(1).max(64).optional(),
  hsnSac: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,8}$/).nullable().optional(),
  gstRate: z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/).refine((value) => Number(value) <= 100).optional(),
  purchaseRate: nonnegativeDecimal(12, 4).optional(),
  salesRate: nonnegativeDecimal(12, 4).optional(),
  mrp: nonnegativeDecimal(12, 4).nullable().optional(),
  reorderLevel: nonnegativeDecimal(12, 6).optional(),
  minimumLevel: nonnegativeDecimal(12, 6).optional(),
  maximumLevel: nonnegativeDecimal(12, 6).nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.values(value).some((field) => field !== undefined));

export const stockGroupCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9_-]+$/),
  parentId: z.string().min(1).max(64).nullable().optional(),
  description: optionalText(240),
});

export const stockGroupUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  parentId: z.string().min(1).max(64).nullable().optional(),
  description: optionalText(240),
}).refine((value) => Object.values(value).some((field) => field !== undefined));

export const unitCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  symbol: z.string().trim().min(1).max(16),
  precision: z.number().int().min(0).max(6).default(3),
});

export const unitConversionCreateSchema = z.object({
  fromUnitId: z.string().min(1).max(64),
  toUnitId: z.string().min(1).max(64),
  factor: positiveDecimal(10, 8),
}).refine((value) => value.fromUnitId !== value.toUnitId, {
  message: "A unit cannot be converted to itself",
  path: ["toUnitId"],
});

export const warehouseCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().min(2).max(40).regex(/^[A-Z0-9_-]+$/),
  parentId: z.string().min(1).max(64).nullable().optional(),
  address: optionalText(240),
});

export const warehouseUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  parentId: z.string().min(1).max(64).nullable().optional(),
  address: optionalText(240),
  isActive: z.boolean().optional(),
}).refine((value) => Object.values(value).some((field) => field !== undefined));

export const inventoryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  groupId: z.string().min(1).max(64).optional(),
  warehouseId: z.string().min(1).max(64).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  lowStock: z.preprocess((value) =>
    value === "true" ? true : value === "false" ? false : value,
  z.boolean()).optional(),
  batchTracked: z.preprocess((value) =>
    value === "true" ? true : value === "false" ? false : value,
  z.boolean()).optional(),
});
