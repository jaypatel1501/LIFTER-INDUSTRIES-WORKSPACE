import type { Prisma } from "@prisma/client";

export const DEFAULT_STOCK_GROUPS = [
  { code: "GENERAL", name: "General Stock", parent: null },
  { code: "RAW_MATERIALS", name: "Raw Materials", parent: "GENERAL" },
  { code: "FINISHED_GOODS", name: "Finished Goods", parent: "GENERAL" },
  { code: "PACKING_MATERIALS", name: "Packing Materials", parent: "GENERAL" },
  { code: "CONSUMABLES", name: "Consumables", parent: "GENERAL" },
  { code: "SERVICES", name: "Services", parent: "GENERAL" },
] as const;

export const DEFAULT_UNITS = [
  { name: "Pieces", symbol: "pcs", precision: 0 },
  { name: "Kilogram", symbol: "kg", precision: 3 },
  { name: "Gram", symbol: "g", precision: 3 },
  { name: "Litre", symbol: "L", precision: 3 },
  { name: "Millilitre", symbol: "mL", precision: 3 },
  { name: "Metre", symbol: "m", precision: 3 },
  { name: "Centimetre", symbol: "cm", precision: 3 },
  { name: "Box", symbol: "box", precision: 0 },
  { name: "Hour", symbol: "hr", precision: 2 },
] as const;

export async function ensureDefaultInventoryMasters(
  tx: Prisma.TransactionClient,
  companyId: string,
) {
  const groups = new Map<string, string>();
  for (const group of DEFAULT_STOCK_GROUPS) {
    const saved = await tx.stockGroup.upsert({
      where: { companyId_code: { companyId, code: group.code } },
      create: {
        companyId,
        name: group.name,
        code: group.code,
        isSystem: true,
        parentId: group.parent ? groups.get(group.parent)! : null,
      },
      update: {},
      select: { id: true },
    });
    groups.set(group.code, saved.id);
  }

  const units = new Map<string, string>();
  for (const unit of DEFAULT_UNITS) {
    const saved = await tx.unitOfMeasure.upsert({
      where: { companyId_symbol: { companyId, symbol: unit.symbol } },
      create: { companyId, ...unit, isSystem: true },
      update: {},
      select: { id: true },
    });
    units.set(unit.symbol, saved.id);
  }

  for (const conversion of [
    { from: "kg", to: "g", factor: "1000" },
    { from: "L", to: "mL", factor: "1000" },
    { from: "m", to: "cm", factor: "100" },
  ]) {
    const fromUnitId = units.get(conversion.from);
    const toUnitId = units.get(conversion.to);
    if (!fromUnitId || !toUnitId) throw new Error("Default inventory unit conversion is incomplete");
    await tx.unitConversion.upsert({
      where: { companyId_fromUnitId_toUnitId: { companyId, fromUnitId, toUnitId } },
      create: { companyId, fromUnitId, toUnitId, factor: conversion.factor },
      update: {},
    });
  }

  const warehouse = await tx.warehouse.upsert({
    where: { companyId_code: { companyId, code: "MAIN" } },
    create: { companyId, name: "Main Godown", code: "MAIN", isSystem: true },
    update: {},
    select: { id: true },
  });
  return { groups, units, warehouseId: warehouse.id };
}
