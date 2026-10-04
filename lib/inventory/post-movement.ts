import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashIdempotencyKey } from "@/lib/idempotency";
import { withTransaction } from "@/lib/transactions";
import { inventoryOpeningStockSchema, isDecimalWithinPrecision } from "@/lib/validation/inventory";
import type { z } from "zod";

type MovementInput = z.infer<typeof inventoryOpeningStockSchema>;
type MovementType = "OPENING" | "PURCHASE" | "SALES" | "SALES_RETURN" | "PURCHASE_RETURN" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT" | "PRODUCTION_IN" | "PRODUCTION_OUT" | "JOB_WORK_IN" | "JOB_WORK_OUT";
type Direction = "IN" | "OUT";
type ActorContext = { companyId: string; userId: string };
type RequestInfo = { ipAddress?: string | undefined; userAgent?: string | undefined };

function movementHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function day(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function stockValue(quantity: Prisma.Decimal, unitCost: Prisma.Decimal, precision = 4) {
  return quantity.mul(unitCost).toDecimalPlaces(precision, Prisma.Decimal.ROUND_HALF_UP);
}

export async function postInventoryMovement(
  tx: Prisma.TransactionClient,
  context: ActorContext,
  options: {
    itemId: string;
    input: MovementInput;
    date: string;
    type: MovementType;
    direction: Direction;
    idempotencyKey: string;
    voucherId?: string | null;
    requestInfo?: RequestInfo;
  },
) {
  const key = hashIdempotencyKey(options.idempotencyKey);
  const requestHash = movementHash({
    itemId: options.itemId,
    input: options.input,
    date: options.date,
    type: options.type,
    direction: options.direction,
    voucherId: options.voucherId ?? null,
  });
  const existing = await tx.inventoryMovement.findUnique({
    where: { companyId_idempotencyKey: { companyId: context.companyId, idempotencyKey: key } },
    select: { id: true, requestHash: true },
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new ConflictError("Movement Idempotency-Key was already used for different stock details");
    }
    return { movementId: existing.id, replayed: true };
  }

  const [item, warehouse] = await Promise.all([
    tx.stockItem.findFirst({
      where: { id: options.itemId, companyId: context.companyId },
      select: { id: true, batchTracked: true, baseUnit: { select: { precision: true } } },
    }),
    tx.warehouse.findFirst({
      where: { id: options.input.warehouseId, companyId: context.companyId, isActive: true },
      select: { id: true },
    }),
  ]);
  if (!item) throw new NotFoundError("Stock item not found in the active company");
  if (!warehouse) throw new NotFoundError("Active warehouse not found in the active company");
  if (!isDecimalWithinPrecision(options.input.quantity, 12, item.baseUnit.precision)) {
    throw new ValidationError(`Quantity exceeds the base unit precision of ${item.baseUnit.precision} decimal places`);
  }
  if (item.batchTracked && !options.input.batchNumber) {
    throw new ValidationError("Batch number is required for a batch-tracked item");
  }
  if (!item.batchTracked && options.input.batchNumber) {
    throw new ValidationError("Batch details are not allowed for an item without batch tracking");
  }
  if (options.voucherId) {
    const voucher = await tx.accountingVoucher.findFirst({
      where: { id: options.voucherId, companyId: context.companyId, status: "POSTED" },
      select: { id: true },
    });
    if (!voucher) throw new NotFoundError("Posted accounting voucher not found in the active company");
  }

  const movementDate = day(options.date);
  const company = await tx.company.findUniqueOrThrow({
    where: { id: context.companyId },
    select: { booksBeginningDate: true },
  });
  const companyBooksDate = company.booksBeginningDate?.toISOString().slice(0, 10);
  if (options.type === "OPENING" && companyBooksDate && companyBooksDate !== options.date) {
    throw new ValidationError("Opening stock date must match the company books-beginning date");
  }
  const [financialYearCount, financialYear] = await Promise.all([
    tx.financialYear.count({ where: { companyId: context.companyId } }),
    tx.financialYear.findFirst({
      where: { companyId: context.companyId, startDate: { lte: movementDate }, endDate: { gte: movementDate } },
      orderBy: { startDate: "desc" },
      select: { id: true, status: true, booksBeginningDate: true },
    }),
  ]);
  if (financialYearCount && !financialYear) {
    throw new ValidationError("Stock movement date must fall within a configured financial year");
  }
  if (financialYear?.status === "CLOSED") throw new ConflictError("Stock cannot be posted in a closed financial year");
  if (options.type === "OPENING" && financialYear &&
      financialYear.booksBeginningDate.toISOString().slice(0, 10) !== options.date) {
    throw new ValidationError("Opening stock date must match the financial year's books-beginning date");
  }

  const quantity = new Prisma.Decimal(options.input.quantity);
  const unitCost = new Prisma.Decimal(options.input.unitCost);
  const value = stockValue(quantity, unitCost, options.type === "OPENING" ? 2 : 4);
  let batchId: string | null = null;
  if (options.input.batchNumber) {
    const batchKey = {
      companyId: context.companyId,
      itemId: item.id,
      warehouseId: warehouse.id,
      batchNumber: options.input.batchNumber,
    };
    const currentBatch = await tx.inventoryBatch.findUnique({
      where: { companyId_itemId_warehouseId_batchNumber: batchKey },
    });
    const manufacturingDate = options.input.manufacturingDate ? day(options.input.manufacturingDate) : null;
    const expiryDate = options.input.expiryDate ? day(options.input.expiryDate) : null;
    if (currentBatch &&
        (currentBatch.manufacturingDate?.getTime() !== manufacturingDate?.getTime() ||
         currentBatch.expiryDate?.getTime() !== expiryDate?.getTime())) {
      throw new ConflictError("The batch number already exists with different manufacturing or expiry dates");
    }
    const batch = currentBatch ?? await tx.inventoryBatch.create({
      data: {
        companyId: context.companyId,
        itemId: item.id,
        warehouseId: warehouse.id,
        batchNumber: options.input.batchNumber,
        manufacturingDate,
        expiryDate,
      },
      select: { id: true },
    });
    batchId = batch.id;
  }

  const locationKey = batchId ?? "NO_BATCH";
  const balance = await tx.stockBalance.findUnique({
    where: {
      companyId_itemId_warehouseId_locationKey: {
        companyId: context.companyId,
        itemId: item.id,
        warehouseId: warehouse.id,
        locationKey,
      },
    },
    select: { id: true, quantity: true, value: true },
  });
  const quantityDelta = options.direction === "IN" ? quantity : quantity.negated();
  const valueDelta = options.direction === "IN" ? value : value.negated();
  if (options.direction === "OUT" &&
      (!balance || balance.quantity.lessThan(quantity) || balance.value.lessThan(value))) {
    throw new ConflictError("Insufficient quantity or inventory value at the selected location and batch");
  }

  const movement = await tx.inventoryMovement.create({
    data: {
      companyId: context.companyId,
      itemId: item.id,
      warehouseId: warehouse.id,
      batchId,
      voucherId: options.voucherId ?? null,
      movementType: options.type,
      direction: options.direction,
      quantity,
      unitCost,
      value,
      movementDate,
      idempotencyKey: key,
      requestHash,
      createdById: context.userId,
    },
    select: { id: true },
  });

  if (!balance && options.direction === "IN") {
    await tx.stockBalance.create({
      data: {
        companyId: context.companyId,
        itemId: item.id,
        warehouseId: warehouse.id,
        batchId,
        locationKey,
        quantity,
        value,
      },
    });
  } else if (balance) {
    const updated = await tx.stockBalance.updateMany({
      where: {
        id: balance.id,
        companyId: context.companyId,
        quantity: { gte: options.direction === "OUT" ? quantity : 0 },
        value: { gte: options.direction === "OUT" ? value : 0 },
      },
      data: { quantity: { increment: quantityDelta }, value: { increment: valueDelta } },
    });
    if (updated.count !== 1) throw new ConflictError("Stock balance changed concurrently; retry the movement");
  } else {
    throw new ConflictError("Stock balance is not available for an outgoing movement");
  }

  await writeAuditLog({
    companyId: context.companyId,
    actorId: context.userId,
    action: "INVENTORY_MOVEMENT_POSTED",
    entityType: "InventoryMovement",
    entityId: movement.id,
    changes: {
      itemId: item.id, warehouseId: warehouse.id, batchId,
      direction: options.direction, quantity: quantity.toString(), value: value.toString(),
      movementType: options.type, voucherId: options.voucherId ?? null,
    },
    ...options.requestInfo,
  }, tx);
  return { movementId: movement.id, replayed: false };
}

export async function withInventoryTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return withTransaction(operation);
}
