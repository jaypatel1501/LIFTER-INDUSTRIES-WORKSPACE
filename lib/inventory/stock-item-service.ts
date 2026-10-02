import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { ensureDefaultChart } from "@/lib/accounting/default-chart";
import { createPostedVoucherWithinTransaction } from "@/lib/accounting/voucher-platform";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashIdempotencyKey } from "@/lib/idempotency";
import { postInventoryMovement } from "@/lib/inventory/post-movement";
import { withTransaction } from "@/lib/transactions";
import type { stockItemCreateSchema } from "@/lib/validation/inventory";
import type { z } from "zod";

type Input = z.infer<typeof stockItemCreateSchema>;
type Context = { companyId: string; userId: string };
type RequestInfo = { ipAddress?: string | undefined; userAgent?: string | undefined };

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function dateValue(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function createStockItemWithOpening(
  context: Context,
  input: Input,
  idempotencyHeader: string | null,
  requestInfo: RequestInfo,
) {
  if (!idempotencyHeader) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(`inventory-item:${idempotencyHeader}`);
  const requestHash = hash(input);
  return withTransaction(async (tx) => {
    const existing = await tx.stockItem.findUnique({
      where: { companyId_creationKey: { companyId: context.companyId, creationKey: key } },
      include: {
        group: { select: { id: true, name: true, code: true } },
        baseUnit: { select: { id: true, name: true, symbol: true, precision: true } },
        alternateUnits: { include: { unit: { select: { id: true, name: true, symbol: true } } } },
        balances: {
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
            batch: { select: { id: true, batchNumber: true, manufacturingDate: true, expiryDate: true } },
          },
        },
      },
    });
    if (existing) {
      if (existing.creationHash !== requestHash) {
        throw new ConflictError("Idempotency-Key was already used for a different stock-item request");
      }
      return { item: existing, replayed: true };
    }
    const [group, baseUnit] = await Promise.all([
      tx.stockGroup.findFirst({
        where: { id: input.groupId, companyId: context.companyId },
        select: { id: true },
      }),
      tx.unitOfMeasure.findFirst({
        where: { id: input.baseUnitId, companyId: context.companyId },
        select: { id: true },
      }),
    ]);
    if (!group) throw new NotFoundError("Stock group not found in the active company");
    if (!baseUnit) throw new NotFoundError("Base unit not found in the active company");
    if (input.alternateUnits.length) {
      const units = await tx.unitOfMeasure.findMany({
        where: { id: { in: input.alternateUnits.map(({ unitId }) => unitId) }, companyId: context.companyId },
        select: { id: true },
      });
      if (units.length !== input.alternateUnits.length) {
        throw new NotFoundError("One or more alternate units are not in the active company");
      }
    }
    const item = await tx.stockItem.create({
      data: {
        companyId: context.companyId,
        name: input.name,
        code: input.code || null,
        groupId: group.id,
        baseUnitId: baseUnit.id,
        hsnSac: input.hsnSac || null,
        gstRate: new Prisma.Decimal(input.gstRate),
        purchaseRate: new Prisma.Decimal(input.purchaseRate),
        salesRate: new Prisma.Decimal(input.salesRate),
        mrp: input.mrp ? new Prisma.Decimal(input.mrp) : null,
        reorderLevel: new Prisma.Decimal(input.reorderLevel),
        minimumLevel: new Prisma.Decimal(input.minimumLevel),
        maximumLevel: input.maximumLevel ? new Prisma.Decimal(input.maximumLevel) : null,
        batchTracked: input.batchTracked,
        barcode: input.barcode || null,
        creationKey: key,
        creationHash: requestHash,
      },
      select: { id: true, name: true },
    });
    if (input.alternateUnits.length) {
      await tx.itemUnitConversion.createMany({
        data: input.alternateUnits.map((conversion) => ({
          companyId: context.companyId,
          itemId: item.id,
          unitId: conversion.unitId,
          baseQuantity: new Prisma.Decimal(conversion.baseQuantity),
          barcode: conversion.barcode || null,
        })),
      });
    }

    let voucherId: string | null = null;
    if (input.openingStock.length) {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: context.companyId },
        select: { booksBeginningDate: true },
      });
      if (!input.openingDate) throw new ValidationError("Opening date is required when opening stock is entered");
      const dateText = input.openingDate;
      const companyBooksDate = company.booksBeginningDate?.toISOString().slice(0, 10);
      if (companyBooksDate && companyBooksDate !== dateText) {
        throw new ValidationError("Opening stock date must match the company books-beginning date");
      }
      const [financialYearCount, financialYear] = await Promise.all([
        tx.financialYear.count({ where: { companyId: context.companyId } }),
        tx.financialYear.findFirst({
          where: {
            companyId: context.companyId,
            startDate: { lte: dateValue(dateText) },
            endDate: { gte: dateValue(dateText) },
          },
          orderBy: { startDate: "desc" },
          select: { id: true, status: true, booksBeginningDate: true },
        }),
      ]);
      if (financialYearCount && !financialYear) {
        throw new ValidationError("Opening stock date must fall within a configured financial year");
      }
      if (financialYear?.status === "CLOSED") throw new ConflictError("Opening stock cannot be posted in a closed financial year");
      if (financialYear && financialYear.booksBeginningDate.toISOString().slice(0, 10) !== dateText) {
        throw new ValidationError("Opening stock date must match the financial year's books-beginning date");
      }

      const chart = await ensureDefaultChart(tx, context.companyId);
      const openingValue = input.openingStock.reduce(
        (total, row) => total.plus(
          new Prisma.Decimal(row.quantity)
            .mul(new Prisma.Decimal(row.unitCost))
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        ),
        new Prisma.Decimal(0),
      );
      if (openingValue.greaterThan(0)) {
        const voucher = await createPostedVoucherWithinTransaction(
          tx,
          context,
          {
            type: "OPENING_BALANCE",
            voucherDate: dateText,
            narration: `Opening stock · ${item.name}`,
            idempotencyKey: key,
            requestHash,
            lines: [
              {
                ledgerId: chart.inventoryLedgerId,
                description: `Opening stock · ${item.name}`,
                debit: openingValue.toString(),
                credit: "0",
              },
              {
                ledgerId: chart.openingLedgerId,
                description: "Opening stock offset",
                debit: "0",
                credit: openingValue.toString(),
              },
            ],
          },
        );
        voucherId = voucher.id;
      }

      for (const [index, row] of input.openingStock.entries()) {
        await postInventoryMovement(tx, context, {
          itemId: item.id,
          input: row,
          date: dateText,
          type: "OPENING",
          direction: "IN",
          idempotencyKey: `${key}:opening:${index}`,
          voucherId,
          requestInfo,
        });
      }
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "OPENING_STOCK_POSTED",
        entityType: "StockItem",
        entityId: item.id,
        changes: {
          openingDate: dateText,
          totalValue: openingValue.toString(),
          locations: input.openingStock.length,
          voucherId,
        },
        ...requestInfo,
      }, tx);
    }

    await writeAuditLog({
      companyId: context.companyId,
      actorId: context.userId,
      action: "STOCK_ITEM_CREATED",
      entityType: "StockItem",
      entityId: item.id,
      changes: {
        name: item.name,
        groupId: input.groupId,
        baseUnitId: input.baseUnitId,
        batchTracked: input.batchTracked,
        barcode: input.barcode || null,
        openingVoucherId: voucherId,
      },
      ...requestInfo,
    }, tx);
    const created = await tx.stockItem.findUniqueOrThrow({
      where: { id: item.id },
      include: {
        group: { select: { id: true, name: true, code: true } },
        baseUnit: { select: { id: true, name: true, symbol: true, precision: true } },
        alternateUnits: { include: { unit: { select: { id: true, name: true, symbol: true } } } },
        balances: {
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
            batch: { select: { id: true, batchNumber: true, manufacturingDate: true, expiryDate: true } },
          },
        },
      },
    });
    return { item: created, replayed: false };
  });
}
