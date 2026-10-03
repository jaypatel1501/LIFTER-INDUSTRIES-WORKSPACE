import { createHash } from "node:crypto";
import {
  BillReferenceType,
  DayBookEventType,
  InventoryDirection,
  Prisma,
  VoucherApprovalStatus,
  VoucherAuditAction,
  VoucherStatus,
  VoucherTaxType,
  VoucherType,
} from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashIdempotencyKey } from "@/lib/idempotency";
import { postInventoryMovement } from "@/lib/inventory/post-movement";
import { applyBillSettlements, validateBillAllocations } from "@/lib/accounting/outstanding";
import { assertBalancedVoucher } from "@/lib/accounting/voucher-validation";
import { withTransaction } from "@/lib/transactions";
import type { voucherDraftSchema } from "@/lib/validation/vouchers";
import type { z } from "zod";

type Context = { companyId: string; userId: string };
type RequestInfo = { ipAddress?: string | undefined; userAgent?: string | undefined };
type VoucherInput = z.infer<typeof voucherDraftSchema>;
type VoucherLineInput = VoucherInput["lines"][number];

const PREFIXES: Record<VoucherType, string> = {
  OPENING_BALANCE: "OB",
  JOURNAL: "JV",
  SALES: "SAL",
  PURCHASE: "PUR",
  PAYMENT: "PAY",
  RECEIPT: "REC",
  CONTRA: "CON",
  SALES_RETURN: "SR",
  CREDIT_NOTE: "CN",
  DEBIT_NOTE: "DN",
};

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function day(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateText(value: Date) {
  return value.toISOString().slice(0, 10);
}

function amount(value: string) {
  return new Prisma.Decimal(value);
}

function sumLines(lines: readonly { debit: string; credit: string }[]) {
  return lines.reduce((totals, line) => ({
    debit: totals.debit.plus(amount(line.debit)),
    credit: totals.credit.plus(amount(line.credit)),
  }), { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) });
}

async function resolveFinancialYear(
  tx: Prisma.TransactionClient,
  companyId: string,
  voucherDate: Date,
) {
  const [count, financialYear, company] = await Promise.all([
    tx.financialYear.count({ where: { companyId } }),
    tx.financialYear.findFirst({
      where: {
        companyId,
        startDate: { lte: voucherDate },
        endDate: { gte: voucherDate },
      },
      orderBy: { startDate: "desc" },
    }),
    tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { booksBeginningDate: true },
    }),
  ]);
  if (count > 0 && !financialYear) {
    throw new ValidationError("Voucher date must fall within a configured financial year");
  }
  const booksBeginningDate = financialYear?.booksBeginningDate ?? company.booksBeginningDate;
  if (booksBeginningDate && voucherDate < booksBeginningDate) {
    throw new ValidationError("Voucher date cannot be before the books-beginning date");
  }
  if (financialYear?.status === "CLOSED") {
    throw new ConflictError("Vouchers cannot be created or posted in a closed financial year");
  }
  return financialYear;
}

async function getOrCreateSeries(
  tx: Prisma.TransactionClient,
  companyId: string,
  voucherType: VoucherType,
  financialYear: { id: string; name: string; startDate: Date; endDate: Date } | null,
) {
  const periodKey = financialYear?.id ?? "DEFAULT";
  const existing = await tx.voucherNumberSeries.findUnique({
    where: { companyId_voucherType_periodKey: { companyId, voucherType, periodKey } },
  });
  if (existing) {
    if (!existing.isActive) throw new ConflictError("The voucher number series for this financial year is inactive");
    return existing;
  }
  const fiscalSuffix = financialYear
    ? `${String(financialYear.startDate.getUTCFullYear()).slice(-2)}-${String(financialYear.endDate.getUTCFullYear()).slice(-2)}-`
    : "";
  return tx.voucherNumberSeries.create({
    data: {
      companyId,
      voucherType,
      financialYearId: financialYear?.id ?? null,
      periodKey,
      prefix: `${PREFIXES[voucherType]}-${fiscalSuffix}`,
    },
  });
}

async function allocateVoucherNumber(
  tx: Prisma.TransactionClient,
  seriesId: string,
) {
  const series = await tx.voucherNumberSeries.update({
    where: { id: seriesId },
    data: { nextNumber: { increment: 1 } },
    select: { prefix: true, suffix: true, padding: true, nextNumber: true },
  });
  const serial = String(series.nextNumber - 1).padStart(series.padding, "0");
  return `${series.prefix}${serial}${series.suffix}`;
}

async function appendVoucherHistory(
  tx: Prisma.TransactionClient,
  context: Context,
  voucher: {
    id: string;
    type: VoucherType;
    voucherNumber: string;
    voucherDate: Date;
    narration: string | null;
  },
  action: VoucherAuditAction,
  eventType: DayBookEventType,
  snapshot: Prisma.InputJsonValue,
  requestInfo: RequestInfo = {},
) {
  await tx.voucherAuditEvent.create({
    data: {
      companyId: context.companyId,
      voucherId: voucher.id,
      actorId: context.userId,
      action,
      snapshot,
    },
  });
  await tx.dayBookEntry.create({
    data: {
      companyId: context.companyId,
      voucherId: voucher.id,
      actorId: context.userId,
      eventType,
      voucherType: voucher.type,
      voucherNumber: voucher.voucherNumber,
      voucherDate: voucher.voucherDate,
      narration: voucher.narration,
    },
  });
  await writeAuditLog({
    companyId: context.companyId,
    actorId: context.userId,
    action: `VOUCHER_${action}`,
    entityType: "AccountingVoucher",
    entityId: voucher.id,
    changes: snapshot,
    ...requestInfo,
  }, tx);
}

async function validateCompanyLines(
  tx: Prisma.TransactionClient,
  companyId: string,
  lines: readonly VoucherLineInput[],
) {
  const ledgerIds = [...new Set(lines.map(({ ledgerId }) => ledgerId))];
  const ledgers = await tx.ledger.findMany({
    where: { companyId, id: { in: ledgerIds }, isActive: true },
    select: { id: true, type: true, costCentreEnabled: true, party: { select: { type: true } } },
  });
  if (ledgers.length !== ledgerIds.length) {
    throw new NotFoundError("Every voucher ledger must be active in the current company");
  }
  const byId = new Map(ledgers.map((ledger) => [ledger.id, ledger]));
  const costCentreIds = [...new Set(lines.flatMap((line) => line.costAllocations.map(({ costCentreId }) => costCentreId)))];
  const costCentres = costCentreIds.length
    ? await tx.costCentre.findMany({
        where: { companyId, id: { in: costCentreIds }, isActive: true },
        select: { id: true },
      })
    : [];
  if (costCentres.length !== costCentreIds.length) {
    throw new NotFoundError("Every cost centre must be active in the current company");
  }
  for (const line of lines) {
    if (line.costAllocations.length && !byId.get(line.ledgerId)?.costCentreEnabled) {
      throw new ValidationError("Cost allocations require a ledger configured for cost centres");
    }
    if (line.bills.length && !byId.get(line.ledgerId)?.party) {
      throw new ValidationError("Bill-wise allocations require a customer or supplier ledger");
    }
    for (const bill of line.bills) {
      const partyType = byId.get(line.ledgerId)?.party?.type;
      if (bill.referenceType === "NEW" && partyType === "CUSTOMER" && (amount(line.debit).isZero() || !amount(line.credit).isZero())) {
        throw new ValidationError("New customer bills must be allocated to a debit on the customer ledger");
      }
      if (bill.referenceType === "NEW" && partyType === "SUPPLIER" && (amount(line.credit).isZero() || !amount(line.debit).isZero())) {
        throw new ValidationError("New supplier bills must be allocated to a credit on the supplier ledger");
      }
    }
    for (const tax of line.taxes) {
      const taxLedger = await tx.ledger.findFirst({
        where: { id: tax.taxLedgerId, companyId, isActive: true },
        select: { id: true },
      });
      if (!taxLedger) throw new NotFoundError("Tax ledger must be active in the current company");
    }
    if (line.stock) {
      const [item, warehouse] = await Promise.all([
        tx.stockItem.findFirst({
          where: { id: line.stock.itemId, companyId, isActive: true },
          select: { id: true, batchTracked: true },
        }),
        tx.warehouse.findFirst({
          where: { id: line.stock.warehouseId, companyId, isActive: true },
          select: { id: true },
        }),
      ]);
      if (!item || !warehouse) throw new NotFoundError("Stock item and warehouse must be active in the current company");
      if (item.batchTracked && !line.stock.batchNumber) {
        throw new ValidationError("A batch number is required for batch-tracked stock");
      }
      if (!item.batchTracked && line.stock.batchNumber) {
        throw new ValidationError("Batch details are not allowed for an item without batch tracking");
      }
    }
  }
  await validateBillAllocations(tx, companyId, lines);
}

async function validateVoucherTypeRules(
  tx: Prisma.TransactionClient,
  companyId: string,
  type: VoucherType,
  lines: readonly { ledgerId: string; debit: string; credit: string; stock?: { movementType: string; direction: string } | undefined }[],
  paymentMethod?: string | null,
) {
  if (type === VoucherType.SALES_RETURN && lines.some((line) => line.stock && (line.stock.movementType !== "SALES_RETURN" || line.stock.direction !== "IN"))) {
    throw new ValidationError("Sales return stock must be posted as an incoming SALES_RETURN movement");
  }
  if (type === VoucherType.SALES_RETURN) {
    const customerIds = await tx.ledger.findMany({ where: { companyId, id: { in: [...new Set(lines.map((line) => line.ledgerId))] }, type: "PARTY", party: { type: "CUSTOMER" } }, select: { id: true } });
    if (!lines.some((line) => customerIds.some((ledger) => ledger.id === line.ledgerId) && amount(line.credit).greaterThan(0))) {
      throw new ValidationError("Sales returns must credit the customer ledger");
    }
  }
  if (type === VoucherType.CREDIT_NOTE || type === VoucherType.DEBIT_NOTE) {
    const ledgers = await tx.ledger.findMany({ where: { companyId, id: { in: [...new Set(lines.map((line) => line.ledgerId))] }, type: "PARTY" },
      select: { id: true, party: { select: { type: true } } } });
    const parties = new Map(ledgers.map((ledger) => [ledger.id, ledger.party?.type]));
    const hasPartyLeg = lines.some((line) => {
      const partyType = parties.get(line.ledgerId);
      if (!partyType) return false;
      if (type === VoucherType.CREDIT_NOTE) return partyType === "CUSTOMER" ? Number(line.credit) > 0 : Number(line.debit) > 0;
      return partyType === "CUSTOMER" ? Number(line.debit) > 0 : Number(line.credit) > 0;
    });
    if (!hasPartyLeg) throw new ValidationError(type === VoucherType.CREDIT_NOTE
      ? "Credit notes must credit a customer or debit a supplier ledger"
      : "Debit notes must debit a customer or credit a supplier ledger");
  }
  if (type !== VoucherType.PAYMENT && type !== VoucherType.RECEIPT && type !== VoucherType.CONTRA) return;
  const ledgers = await tx.ledger.findMany({ where: { companyId, id: { in: [...new Set(lines.map((line) => line.ledgerId))] }, isActive: true }, select: { id: true, type: true } });
  const types = new Map(ledgers.map((ledger) => [ledger.id, ledger.type]));
  const cashBank = (ledgerId: string) => ["CASH", "BANK"].includes(types.get(ledgerId) ?? "");
  const hasCashBankDebit = lines.some((line) => cashBank(line.ledgerId) && amount(line.debit).greaterThan(0));
  const hasCashBankCredit = lines.some((line) => cashBank(line.ledgerId) && amount(line.credit).greaterThan(0));
  if (type === VoucherType.PAYMENT && !hasCashBankCredit) throw new ValidationError("Payment vouchers must credit an active cash or bank ledger");
  if (type === VoucherType.RECEIPT && !hasCashBankDebit) throw new ValidationError("Receipt vouchers must debit an active cash or bank ledger");
  if (type === VoucherType.CONTRA && (!lines.every((line) => cashBank(line.ledgerId)) || !hasCashBankDebit || !hasCashBankCredit)) {
    throw new ValidationError("Contra vouchers must transfer value only between cash and bank ledgers");
  }
  if (paymentMethod) {
    const instrumentLedgerType = paymentMethod === "CASH" ? "CASH" : "BANK";
    const instrumentLine = lines.some((line) => types.get(line.ledgerId) === instrumentLedgerType &&
      (type === "PAYMENT" ? amount(line.credit).greaterThan(0) : type === "RECEIPT" ? amount(line.debit).greaterThan(0) : true));
    if (!instrumentLine) throw new ValidationError(`${paymentMethod} settlement requires the corresponding ${instrumentLedgerType.toLowerCase()} ledger`);
  }
}

async function createLineDetails(
  tx: Prisma.TransactionClient,
  context: Context,
  voucherId: string,
  lines: readonly VoucherLineInput[],
) {
  for (const [index, input] of lines.entries()) {
    const line = await tx.voucherLine.create({
      data: {
        companyId: context.companyId,
        voucherId,
        ledgerId: input.ledgerId,
        lineNumber: index + 1,
        description: input.description || null,
        debit: amount(input.debit),
        credit: amount(input.credit),
      },
      select: { id: true },
    });
    if (input.bills.length) {
      await tx.billWiseEntry.createMany({
        data: input.bills.map((bill) => ({
          companyId: context.companyId,
          voucherId,
          voucherLineId: line.id,
          referenceType: bill.referenceType as BillReferenceType,
          referenceNumber: bill.referenceNumber || null,
          settlesEntryId: bill.billEntryId ?? null,
          settlesOpeningId: bill.openingBillId ?? null,
          dueDate: bill.dueDate ? day(bill.dueDate) : null,
          amount: amount(bill.amount),
          settledAmount: amount("0"),
          remainingAmount: bill.referenceType === "NEW" ? amount(bill.amount) : amount("0"),
        })),
      });
    }
    if (input.taxes.length) {
      await tx.voucherTaxDetail.createMany({
        data: input.taxes.map((tax) => ({
          companyId: context.companyId,
          voucherLineId: line.id,
          taxLedgerId: tax.taxLedgerId,
          taxType: tax.taxType as VoucherTaxType,
          taxableAmount: amount(tax.taxableAmount),
          taxAmount: amount(tax.taxAmount),
          rate: amount(tax.rate),
        })),
      });
    }
    if (input.costAllocations.length) {
      await tx.costAllocation.createMany({
        data: input.costAllocations.map((allocation) => ({
          companyId: context.companyId,
          voucherId,
          voucherLineId: line.id,
          costCentreId: allocation.costCentreId,
          amount: amount(allocation.amount),
        })),
      });
    }
    if (input.stock) {
      await tx.voucherStockDetail.create({
        data: {
          companyId: context.companyId,
          voucherLineId: line.id,
          itemId: input.stock.itemId,
          warehouseId: input.stock.warehouseId,
          batchNumber: input.stock.batchNumber || null,
          manufacturingDate: input.stock.manufacturingDate ? day(input.stock.manufacturingDate) : null,
          expiryDate: input.stock.expiryDate ? day(input.stock.expiryDate) : null,
          movementType: input.stock.movementType,
          direction: input.stock.direction,
          quantity: amount(input.stock.quantity),
          unitCost: amount(input.stock.unitCost),
        },
      });
    }
  }
}

async function addPostedTransactions(
  tx: Prisma.TransactionClient,
  context: Context,
  voucher: {
    id: string;
    type: VoucherType;
    voucherNumber: string;
    voucherDate: Date;
    narration: string | null;
  },
  lines: { id: string; ledgerId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; taxDetails: { taxLedgerId: string; taxType: VoucherTaxType; taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; rate: Prisma.Decimal }[] }[],
  requestInfo: RequestInfo,
) {
  await tx.ledgerTransaction.createMany({
    data: lines.map((line) => ({
      companyId: context.companyId,
      voucherId: voucher.id,
      voucherLineId: line.id,
      ledgerId: line.ledgerId,
      transactionDate: voucher.voucherDate,
      debit: line.debit,
      credit: line.credit,
    })),
  });
  const taxes = lines.flatMap((line) => line.taxDetails.map((tax) => ({
    companyId: context.companyId,
    voucherId: voucher.id,
    voucherLineId: line.id,
    ledgerId: tax.taxLedgerId,
    taxType: tax.taxType,
    taxableAmount: tax.taxableAmount,
    taxAmount: tax.taxAmount,
    rate: tax.rate,
    transactionDate: voucher.voucherDate,
  })));
  if (taxes.length) await tx.taxTransaction.createMany({ data: taxes });
  await appendVoucherHistory(
    tx,
    context,
    voucher,
    VoucherAuditAction.POSTED,
    DayBookEventType.POSTED,
    {
      status: "POSTED",
      voucherNumber: voucher.voucherNumber,
      voucherDate: dateText(voucher.voucherDate),
      debit: lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0)).toString(),
      credit: lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0)).toString(),
    },
    requestInfo,
  );
}

function insertAttachments(
  attachments: VoucherInput["attachments"],
) {
  if (!attachments.length) return;
  throw new ValidationError("Voucher attachments must be uploaded through the authenticated attachment endpoint");
}

async function appendLegacyOpeningBills(
  tx: Prisma.TransactionClient,
  companyId: string,
  voucherLines: { id: string }[],
  billDetails: readonly { lineIndex: number; referenceNumber: string; dueDate: string; amount: string }[],
) {
  if (!billDetails.length) return;
  const rows = billDetails.map((bill) => {
    const voucherLine = voucherLines[bill.lineIndex];
    if (!voucherLine) throw new ValidationError("Opening bill detail refers to an unknown voucher line");
    return {
      companyId,
      voucherLineId: voucherLine.id,
      referenceNumber: bill.referenceNumber,
      dueDate: day(bill.dueDate),
      amount: amount(bill.amount),
      settledAmount: amount("0"),
      remainingAmount: amount(bill.amount),
    };
  });
  await tx.billWiseOpening.createMany({ data: rows });
}

export async function createPostedVoucherWithinTransaction(
  tx: Prisma.TransactionClient,
  context: Context,
  input: {
    type: VoucherType;
    voucherDate: string;
    narration: string;
    idempotencyKey: string;
    requestHash: string;
    lines: { ledgerId: string; description?: string | null; debit: string; credit: string }[];
    legacyBills?: { lineIndex: number; referenceNumber: string; dueDate: string; amount: string }[];
    reversalOfId?: string;
    requestInfo?: RequestInfo;
  },
) {
  const date = day(input.voucherDate);
  const financialYear = await resolveFinancialYear(tx, context.companyId, date);
  const series = await getOrCreateSeries(tx, context.companyId, input.type, financialYear);
  assertBalancedVoucher(input.lines);
  const ledgerIds = [...new Set(input.lines.map(({ ledgerId }) => ledgerId))];
  const activeLedgerCount = await tx.ledger.count({
    where: { companyId: context.companyId, id: { in: ledgerIds }, isActive: true },
  });
  if (activeLedgerCount !== ledgerIds.length) {
    throw new NotFoundError("Every voucher ledger must be active in the current company");
  }
  const voucherNumber = await allocateVoucherNumber(tx, series.id);
  const voucher = await tx.accountingVoucher.create({
    data: {
      companyId: context.companyId,
      voucherNumber,
      type: input.type,
      status: VoucherStatus.POSTED,
      approvalStatus: VoucherApprovalStatus.NOT_REQUIRED,
      voucherDate: date,
      financialYearId: financialYear?.id ?? null,
      numberSeriesId: series.id,
      narration: input.narration,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      reversalOfId: input.reversalOfId ?? null,
      createdById: context.userId,
      postedById: context.userId,
      postedAt: new Date(),
    },
    select: { id: true, type: true, voucherNumber: true, voucherDate: true, narration: true },
  });
  const lines = await Promise.all(input.lines.map((line, index) => tx.voucherLine.create({
    data: {
      companyId: context.companyId,
      voucherId: voucher.id,
      ledgerId: line.ledgerId,
      lineNumber: index + 1,
      description: line.description ?? null,
      debit: amount(line.debit),
      credit: amount(line.credit),
    },
    select: { id: true, ledgerId: true, debit: true, credit: true, taxDetails: true },
  })));
  await appendLegacyOpeningBills(tx, context.companyId, lines, input.legacyBills ?? []);
  await addPostedTransactions(tx, context, voucher, lines, input.requestInfo ?? {});
  await writeAuditLog({
    companyId: context.companyId,
    actorId: context.userId,
    action: "VOUCHER_CREATED_AND_POSTED",
    entityType: "AccountingVoucher",
    entityId: voucher.id,
    changes: { voucherType: input.type, voucherNumber, lines: input.lines.length },
    ...input.requestInfo,
  }, tx);
  return voucher;
}

export async function createVoucherDraft(
  context: Context,
  input: VoucherInput,
  rawIdempotencyKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawIdempotencyKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawIdempotencyKey);
  const hash = requestHash(input);
  return withTransaction(async (tx) => {
    const existing = await tx.accountingVoucher.findUnique({
      where: { companyId_idempotencyKey: { companyId: context.companyId, idempotencyKey: key } },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (existing) {
      if (existing.requestHash !== hash) throw new ConflictError("Idempotency-Key was already used for a different voucher request");
      return { voucher: existing, replayed: true };
    }
    const voucherDate = day(input.voucherDate);
    const financialYear = await resolveFinancialYear(tx, context.companyId, voucherDate);
    const series = await getOrCreateSeries(tx, context.companyId, input.type, financialYear);
    await validateCompanyLines(tx, context.companyId, input.lines);
    await validateVoucherTypeRules(tx, context.companyId, input.type, input.lines, input.paymentMethod);
    const voucher = await tx.accountingVoucher.create({
      data: {
        companyId: context.companyId,
        voucherNumber: `DRAFT-${key.slice(0, 24)}`,
        type: input.type,
        status: VoucherStatus.DRAFT,
        approvalStatus: VoucherApprovalStatus.NOT_REQUIRED,
        voucherDate,
        financialYearId: financialYear?.id ?? null,
        numberSeriesId: series.id,
        narration: input.narration || null,
        paymentMethod: input.paymentMethod ?? null,
        paymentReference: input.paymentReference || null,
        paymentDate: input.paymentDate ? day(input.paymentDate) : null,
        paymentBank: input.paymentBank || null,
        idempotencyKey: key,
        requestHash: hash,
        createdById: context.userId,
      },
      select: { id: true, type: true, voucherNumber: true, voucherDate: true, status: true },
    });
    await createLineDetails(tx, context, voucher.id, input.lines);
    await insertAttachments(input.attachments);
    await appendVoucherHistory(
      tx, context, { ...voucher, narration: input.narration || null },
      VoucherAuditAction.CREATED, DayBookEventType.DRAFT_CREATED,
      { status: "DRAFT", requestHash: hash, paymentMethod: input.paymentMethod ?? null,
        paymentReference: input.paymentReference || null, paymentDate: input.paymentDate || null, paymentBank: input.paymentBank || null, lines: input.lines },
      requestInfo,
    );
    return { voucher, replayed: false };
  });
}

export async function updateVoucherDraft(
  context: Context,
  voucherId: string,
  input: VoucherInput,
  requestInfo: RequestInfo,
) {
  return withTransaction(async (tx) => {
    const current = await tx.accountingVoucher.findFirst({
      where: { id: voucherId, companyId: context.companyId },
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
          include: { billEntries: true, taxDetails: true, costAllocations: true, inventoryDetails: true },
        },
        attachments: true,
      },
    });
    if (!current) throw new NotFoundError("Voucher not found in the current company");
    if (current.status !== VoucherStatus.DRAFT) throw new ConflictError("Only draft vouchers can be edited");
    const voucherDate = day(input.voucherDate);
    const financialYear = await resolveFinancialYear(tx, context.companyId, voucherDate);
    const series = await getOrCreateSeries(tx, context.companyId, input.type, financialYear);
    await validateCompanyLines(tx, context.companyId, input.lines);
    await validateVoucherTypeRules(tx, context.companyId, input.type, input.lines, input.paymentMethod);
    await tx.voucherTaxDetail.deleteMany({ where: { companyId: context.companyId, voucherLineId: { in: current.lines.map(({ id }) => id) } } });
    await tx.billWiseEntry.deleteMany({ where: { companyId: context.companyId, voucherLineId: { in: current.lines.map(({ id }) => id) } } });
    await tx.costAllocation.deleteMany({ where: { companyId: context.companyId, voucherId } });
    await tx.voucherStockDetail.deleteMany({ where: { companyId: context.companyId, voucherLineId: { in: current.lines.map(({ id }) => id) } } });
    await tx.voucherLine.deleteMany({ where: { companyId: context.companyId, voucherId } });
    const hash = requestHash(input);
    const updated = await tx.accountingVoucher.update({
      where: { id: voucherId },
      data: {
        type: input.type,
        voucherDate,
        financialYearId: financialYear?.id ?? null,
        numberSeriesId: series.id,
        narration: input.narration || null,
        paymentMethod: input.paymentMethod ?? null,
        paymentReference: input.paymentReference || null,
        paymentDate: input.paymentDate ? day(input.paymentDate) : null,
        paymentBank: input.paymentBank || null,
        requestHash: hash,
        approvalStatus: VoucherApprovalStatus.NOT_REQUIRED,
      },
      select: { id: true, type: true, voucherNumber: true, voucherDate: true, narration: true },
    });
    await createLineDetails(tx, context, voucherId, input.lines);
    await insertAttachments(input.attachments);
    await appendVoucherHistory(
      tx, context, updated,
      VoucherAuditAction.UPDATED, DayBookEventType.DRAFT_UPDATED,
      {
        before: {
          requestHash: current.requestHash,
          paymentMethod: current.paymentMethod,
          paymentReference: current.paymentReference,
          paymentDate: current.paymentDate ? dateText(current.paymentDate) : null,
          paymentBank: current.paymentBank,
          lines: current.lines.map((line) => ({
            ledgerId: line.ledgerId,
            description: line.description,
            debit: line.debit.toString(),
            credit: line.credit.toString(),
            bills: line.billEntries.map((bill) => ({ referenceType: bill.referenceType, referenceNumber: bill.referenceNumber, amount: bill.amount.toString() })),
            taxes: line.taxDetails.map((tax) => ({ taxLedgerId: tax.taxLedgerId, taxType: tax.taxType, taxableAmount: tax.taxableAmount.toString(), taxAmount: tax.taxAmount.toString() })),
            costAllocations: line.costAllocations.map((allocation) => ({ costCentreId: allocation.costCentreId, amount: allocation.amount.toString() })),
            stock: line.inventoryDetails[0] ? { itemId: line.inventoryDetails[0].itemId, warehouseId: line.inventoryDetails[0].warehouseId, quantity: line.inventoryDetails[0].quantity.toString(), direction: line.inventoryDetails[0].direction } : null,
          })),
          attachments: current.attachments.map(({ objectKey, fileName, contentType, byteSize }) => ({ objectKey, fileName, contentType, byteSize })),
        },
        after: { requestHash: hash, paymentMethod: input.paymentMethod ?? null,
          paymentReference: input.paymentReference || null, paymentDate: input.paymentDate || null,
          paymentBank: input.paymentBank || null, lines: input.lines },
      },
      requestInfo,
    );
    return updated;
  });
}

export async function requestVoucherApproval(
  context: Context,
  voucherId: string,
  rawIdempotencyKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawIdempotencyKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawIdempotencyKey);
  return withTransaction(async (tx) => {
    const previousAction = await tx.voucherApprovalAction.findUnique({
      where: { companyId_idempotencyKey: { companyId: context.companyId, idempotencyKey: key } },
    });
    if (previousAction) {
      if (previousAction.voucherId !== voucherId || previousAction.decision !== VoucherApprovalStatus.PENDING) {
        throw new ConflictError("Idempotency-Key was already used for a different approval action");
      }
      return { replayed: true };
    }
    const voucher = await tx.accountingVoucher.findFirst({
      where: { id: voucherId, companyId: context.companyId, status: VoucherStatus.DRAFT },
      include: { numberSeries: true },
    });
    if (!voucher) throw new NotFoundError("Draft voucher not found");
    if (!voucher.numberSeries?.requiresApproval) throw new ConflictError("Approval is not required for this voucher series");
    if (voucher.approvalStatus !== VoucherApprovalStatus.NOT_REQUIRED && voucher.approvalStatus !== VoucherApprovalStatus.REJECTED) {
      throw new ConflictError("Voucher is already awaiting or has received approval");
    }
    const updated = await tx.accountingVoucher.update({
      where: { id: voucher.id },
      data: { approvalStatus: VoucherApprovalStatus.PENDING },
      select: { id: true, type: true, voucherNumber: true, voucherDate: true, narration: true },
    });
    await tx.voucherApprovalAction.create({
      data: {
        companyId: context.companyId,
        voucherId,
        actorId: context.userId,
        decision: VoucherApprovalStatus.PENDING,
        idempotencyKey: key,
      },
    });
    await appendVoucherHistory(
      tx, context, updated,
      VoucherAuditAction.APPROVAL_REQUESTED, DayBookEventType.APPROVAL_REQUESTED,
      { approvalStatus: "PENDING" }, requestInfo,
    );
    return { voucher: updated, replayed: false };
  });
}

export async function decideVoucherApproval(
  context: Context,
  voucherId: string,
  decision: "APPROVED" | "REJECTED",
  reason: string | undefined,
  rawIdempotencyKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawIdempotencyKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawIdempotencyKey);
  return withTransaction(async (tx) => {
    const event = await tx.voucherApprovalAction.findFirst({
      where: { companyId: context.companyId, idempotencyKey: key },
    });
    if (event) {
      if (event.voucherId !== voucherId || event.decision !== decision) {
        throw new ConflictError("Idempotency-Key was already used for a different approval action");
      }
      return { replayed: true };
    }
    const voucher = await tx.accountingVoucher.findFirst({
      where: { id: voucherId, companyId: context.companyId, status: VoucherStatus.DRAFT },
    });
    if (!voucher) throw new NotFoundError("Draft voucher not found");
    if (voucher.approvalStatus !== VoucherApprovalStatus.PENDING) {
      throw new ConflictError("Voucher is not awaiting approval");
    }
    if (voucher.createdById === context.userId) {
      throw new ConflictError("The user who created a voucher cannot approve their own voucher");
    }
    await tx.voucherApprovalAction.create({
      data: {
        companyId: context.companyId,
        voucherId,
        actorId: context.userId,
        decision: decision as VoucherApprovalStatus,
        idempotencyKey: key,
        reason: reason || null,
      },
    });
    const updated = await tx.accountingVoucher.update({
      where: { id: voucher.id },
      data: { approvalStatus: decision as VoucherApprovalStatus },
      select: { id: true, type: true, voucherNumber: true, voucherDate: true, narration: true },
    });
    const action = decision === "APPROVED" ? VoucherAuditAction.APPROVED : VoucherAuditAction.REJECTED;
    const eventType = decision === "APPROVED" ? DayBookEventType.APPROVED : DayBookEventType.REJECTED;
    await appendVoucherHistory(
      tx, context, updated, action, eventType,
      { approvalStatus: decision, reason: reason ?? null }, requestInfo,
    );
    return { voucher: updated, replayed: false };
  });
}

export async function postVoucher(
  context: Context,
  voucherId: string,
  rawIdempotencyKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawIdempotencyKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawIdempotencyKey);
  const bodyHash = requestHash({ voucherId });
  return withTransaction(async (tx) => {
    const replay = await tx.accountingVoucher.findUnique({
      where: { companyId_postIdempotencyKey: { companyId: context.companyId, postIdempotencyKey: key } },
    });
    if (replay) {
      if (replay.postRequestHash !== bodyHash) throw new ConflictError("Posting Idempotency-Key was used for another voucher");
      return { voucher: replay, replayed: true };
    }
    const voucher = await tx.accountingVoucher.findFirst({
      where: { id: voucherId, companyId: context.companyId },
      include: {
        reversals: { select: { id: true } },
        lines: {
          orderBy: { lineNumber: "asc" },
          include: {
            taxDetails: true,
            billEntries: true,
            costAllocations: true,
            inventoryDetails: true,
          },
        },
        numberSeries: true,
      },
    });
    if (!voucher) throw new NotFoundError("Voucher not found in the current company");
    if (voucher.status !== VoucherStatus.DRAFT) throw new ConflictError("Only draft vouchers can be posted");
    if (voucher.numberSeries?.requiresApproval && voucher.approvalStatus !== VoucherApprovalStatus.APPROVED) {
      throw new ConflictError("This voucher series requires approval before posting");
    }
    if (voucher.approvalStatus === VoucherApprovalStatus.PENDING || voucher.approvalStatus === VoucherApprovalStatus.REJECTED) {
      throw new ConflictError("Voucher approval is pending or rejected");
    }
    const totals = sumLines(voucher.lines.map((line) => ({ debit: line.debit.toString(), credit: line.credit.toString() })));
    assertBalancedVoucher(voucher.lines.map((line) => ({ debit: line.debit.toString(), credit: line.credit.toString() })));
    const financialYear = await resolveFinancialYear(tx, context.companyId, voucher.voucherDate);
    const validationLines = voucher.lines.map((line) => ({
      ledgerId: line.ledgerId,
      description: line.description ?? "",
      debit: line.debit.toString(),
      credit: line.credit.toString(),
      bills: line.billEntries.map((bill) => ({
        referenceType: bill.referenceType,
        referenceNumber: bill.referenceNumber ?? "",
        ...(bill.settlesEntryId ? { billEntryId: bill.settlesEntryId } : {}),
        ...(bill.settlesOpeningId ? { openingBillId: bill.settlesOpeningId } : {}),
        dueDate: bill.dueDate ? dateText(bill.dueDate) : "",
        amount: bill.amount.toString(),
      })),
      taxes: line.taxDetails.map((tax) => ({
        taxLedgerId: tax.taxLedgerId,
        taxType: tax.taxType,
        taxableAmount: tax.taxableAmount.toString(),
        taxAmount: tax.taxAmount.toString(),
        rate: tax.rate.toString(),
      })),
      costAllocations: line.costAllocations.map((allocation) => ({
        costCentreId: allocation.costCentreId,
        amount: allocation.amount.toString(),
      })),
      stock: line.inventoryDetails[0] ? {
        itemId: line.inventoryDetails[0].itemId,
        warehouseId: line.inventoryDetails[0].warehouseId,
        batchNumber: line.inventoryDetails[0].batchNumber ?? "",
        manufacturingDate: line.inventoryDetails[0].manufacturingDate ? dateText(line.inventoryDetails[0].manufacturingDate) : "",
        expiryDate: line.inventoryDetails[0].expiryDate ? dateText(line.inventoryDetails[0].expiryDate) : "",
        movementType: line.inventoryDetails[0].movementType,
        direction: line.inventoryDetails[0].direction,
        quantity: line.inventoryDetails[0].quantity.toString(),
        unitCost: line.inventoryDetails[0].unitCost.toString(),
      } : undefined,
    }));
    await validateCompanyLines(tx, context.companyId, validationLines);
    await validateVoucherTypeRules(tx, context.companyId, voucher.type, validationLines, voucher.paymentMethod);
    await applyBillSettlements(tx, context.companyId, voucher.lines.flatMap((line) => line.billEntries));
    const series = await getOrCreateSeries(tx, context.companyId, voucher.type, financialYear);
    const voucherNumber = await allocateVoucherNumber(tx, series.id);
    const posted = await tx.accountingVoucher.update({
      where: { id: voucher.id },
      data: {
        status: VoucherStatus.POSTED,
        voucherNumber,
        financialYearId: financialYear?.id ?? null,
        numberSeriesId: series.id,
        postIdempotencyKey: key,
        postRequestHash: bodyHash,
        postedById: context.userId,
        postedAt: new Date(),
      },
      select: { id: true, type: true, voucherNumber: true, voucherDate: true, narration: true },
    });
    await tx.ledgerTransaction.createMany({
      data: voucher.lines.map((line) => ({
        companyId: context.companyId,
        voucherId: voucher.id,
        voucherLineId: line.id,
        ledgerId: line.ledgerId,
        transactionDate: voucher.voucherDate,
        debit: line.debit,
        credit: line.credit,
      })),
    });
    const taxTransactions = voucher.lines.flatMap((line) => line.taxDetails.map((tax) => ({
      companyId: context.companyId,
      voucherId: voucher.id,
      voucherLineId: line.id,
      ledgerId: tax.taxLedgerId,
      taxType: tax.taxType,
      taxableAmount: tax.taxableAmount,
      taxAmount: tax.taxAmount,
      rate: tax.rate,
      transactionDate: voucher.voucherDate,
      isReversal: voucher.type === VoucherType.SALES_RETURN || voucher.type === VoucherType.CREDIT_NOTE,
    })));
    if (taxTransactions.length) await tx.taxTransaction.createMany({ data: taxTransactions });
    for (const line of voucher.lines) {
      const detail = line.inventoryDetails[0];
      if (!detail) continue;
      await postInventoryMovement(tx, context, {
        itemId: detail.itemId,
        input: {
          warehouseId: detail.warehouseId,
          quantity: detail.quantity.toString(),
          unitCost: detail.unitCost.toString(),
          batchNumber: detail.batchNumber ?? "",
          manufacturingDate: detail.manufacturingDate ? dateText(detail.manufacturingDate) : "",
          expiryDate: detail.expiryDate ? dateText(detail.expiryDate) : "",
        },
        date: dateText(voucher.voucherDate),
        type: detail.movementType,
        direction: detail.direction,
        idempotencyKey: `${key}:stock:${line.id}`,
        voucherId: voucher.id,
        requestInfo,
      });
    }
    await appendVoucherHistory(
      tx, context, posted, VoucherAuditAction.POSTED, DayBookEventType.POSTED,
      {
        status: "POSTED", voucherNumber, voucherDate: dateText(voucher.voucherDate),
        paymentMethod: voucher.paymentMethod, paymentReference: voucher.paymentReference,
        paymentDate: voucher.paymentDate ? dateText(voucher.paymentDate) : null, paymentBank: voucher.paymentBank,
        debit: totals.debit.toString(), credit: totals.credit.toString(),
      },
      requestInfo,
    );
    return { voucher: posted, replayed: false };
  });
}

export async function cancelVoucherDraft(
  context: Context,
  voucherId: string,
  rawIdempotencyKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawIdempotencyKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawIdempotencyKey);
  const hash = requestHash({ voucherId });
  return withTransaction(async (tx) => {
    const previous = await tx.accountingVoucher.findUnique({
      where: { companyId_cancelIdempotencyKey: { companyId: context.companyId, cancelIdempotencyKey: key } },
    });
    if (previous) {
      if (previous.cancelRequestHash !== hash) throw new ConflictError("Idempotency-Key was used for a different cancellation");
      return { voucher: previous, replayed: true };
    }
    const voucher = await tx.accountingVoucher.findFirst({
      where: { id: voucherId, companyId: context.companyId, status: VoucherStatus.DRAFT },
      select: { id: true, type: true, voucherNumber: true, voucherDate: true, narration: true },
    });
    if (!voucher) throw new NotFoundError("Draft voucher not found");
    const cancelled = await tx.accountingVoucher.update({
      where: { id: voucher.id },
      data: {
        status: VoucherStatus.CANCELLED,
        cancelledById: context.userId,
        cancelledAt: new Date(),
        cancelIdempotencyKey: key,
        cancelRequestHash: hash,
      },
      select: { id: true, type: true, voucherNumber: true, voucherDate: true, narration: true },
    });
    await appendVoucherHistory(
      tx, context, cancelled, VoucherAuditAction.CANCELLED, DayBookEventType.CANCELLED,
      { previousStatus: "DRAFT", status: "CANCELLED" }, requestInfo,
    );
    return { voucher: cancelled, replayed: false };
  });
}

function reversedMovementType(type: string) {
  const reverse: Record<string, string> = {
    PURCHASE: "PURCHASE_RETURN", PURCHASE_RETURN: "PURCHASE",
    SALES: "SALES_RETURN", SALES_RETURN: "SALES",
    TRANSFER_IN: "TRANSFER_OUT", TRANSFER_OUT: "TRANSFER_IN",
    PRODUCTION_IN: "PRODUCTION_OUT", PRODUCTION_OUT: "PRODUCTION_IN",
    JOB_WORK_IN: "JOB_WORK_OUT", JOB_WORK_OUT: "JOB_WORK_IN",
  };
  return (reverse[type] ?? "ADJUSTMENT") as "ADJUSTMENT" | "PURCHASE" | "PURCHASE_RETURN" | "SALES" | "SALES_RETURN" | "TRANSFER_IN" | "TRANSFER_OUT" | "PRODUCTION_IN" | "PRODUCTION_OUT" | "JOB_WORK_IN" | "JOB_WORK_OUT";
}

async function reverseVoucherBillEntries(
  tx: Prisma.TransactionClient,
  companyId: string,
  reversalVoucherId: string,
  reversalLineId: string,
  originalEntries: readonly {
    id: string; referenceType: BillReferenceType; referenceNumber: string | null; dueDate: Date | null; amount: Prisma.Decimal;
    settlesEntryId: string | null; settlesOpeningId: string | null; remainingAmount: Prisma.Decimal;
  }[],
  openingBills: readonly { id: string; referenceNumber: string; dueDate: Date; amount: Prisma.Decimal; settledAmount: Prisma.Decimal; remainingAmount: Prisma.Decimal }[],
) {
  const rows: Prisma.BillWiseEntryCreateManyInput[] = [];
  for (const bill of originalEntries) {
    if (bill.referenceType === BillReferenceType.NEW) {
      if (!bill.remainingAmount.equals(bill.amount)) {
        throw new ConflictError(`Settle or reverse allocations against ${bill.referenceNumber ?? "this bill"} before reversing its voucher`);
      }
      const closed = await tx.billWiseEntry.updateMany({
        where: { id: bill.id, companyId, remainingAmount: bill.amount, settledAmount: 0 },
        data: { remainingAmount: { decrement: bill.amount }, settledAmount: { increment: bill.amount } },
      });
      if (closed.count !== 1) throw new ConflictError("Open bill balance changed while reversing the voucher");
      rows.push({ companyId, voucherId: reversalVoucherId, voucherLineId: reversalLineId,
        referenceType: BillReferenceType.AGAINST_REF, referenceNumber: bill.referenceNumber, dueDate: bill.dueDate,
        amount: bill.amount, settledAmount: 0, remainingAmount: 0, settlesEntryId: bill.id });
      continue;
    }
    if (bill.referenceType === BillReferenceType.AGAINST_REF && bill.settlesEntryId) {
      const restored = await tx.billWiseEntry.updateMany({
        where: { id: bill.settlesEntryId, companyId, settledAmount: { gte: bill.amount } },
        data: { settledAmount: { decrement: bill.amount }, remainingAmount: { increment: bill.amount } },
      });
      if (restored.count !== 1) throw new ConflictError("Open bill settlement changed while reversing the voucher");
    }
    if (bill.referenceType === BillReferenceType.AGAINST_REF && bill.settlesOpeningId) {
      const restored = await tx.billWiseOpening.updateMany({
        where: { id: bill.settlesOpeningId, companyId, settledAmount: { gte: bill.amount } },
        data: { settledAmount: { decrement: bill.amount }, remainingAmount: { increment: bill.amount } },
      });
      if (restored.count !== 1) throw new ConflictError("Opening bill settlement changed while reversing the voucher");
    }
    rows.push({ companyId, voucherId: reversalVoucherId, voucherLineId: reversalLineId,
      referenceType: bill.referenceType, referenceNumber: bill.referenceNumber, dueDate: bill.dueDate,
      amount: bill.amount, settledAmount: 0, remainingAmount: 0,
      settlesEntryId: bill.settlesEntryId, settlesOpeningId: bill.settlesOpeningId });
  }
  for (const bill of openingBills) {
    if (!bill.remainingAmount.equals(bill.amount)) {
      throw new ConflictError(`Settle or reverse allocations against ${bill.referenceNumber} before reversing its opening voucher`);
    }
    const closed = await tx.billWiseOpening.updateMany({
      where: { id: bill.id, companyId, remainingAmount: bill.amount, settledAmount: 0 },
      data: { remainingAmount: { decrement: bill.amount }, settledAmount: { increment: bill.amount } },
    });
    if (closed.count !== 1) throw new ConflictError("Opening bill balance changed while reversing the voucher");
    rows.push({ companyId, voucherId: reversalVoucherId, voucherLineId: reversalLineId,
      referenceType: BillReferenceType.AGAINST_REF, referenceNumber: bill.referenceNumber, dueDate: bill.dueDate,
      amount: bill.amount, settledAmount: 0, remainingAmount: 0, settlesOpeningId: bill.id });
  }
  if (rows.length) await tx.billWiseEntry.createMany({ data: rows });
}

export async function reversePostedVoucher(
  context: Context,
  voucherId: string,
  reversalDate: string,
  rawIdempotencyKey: string | null,
  reason: string,
  requestInfo: RequestInfo,
  transaction?: Prisma.TransactionClient,
) {
  if (!rawIdempotencyKey) throw new ValidationError("Idempotency-Key header is required");
  if (!reason.trim()) throw new ValidationError("A reason is required to reverse a posted voucher");
  const key = hashIdempotencyKey(rawIdempotencyKey);
  const hash = requestHash({ voucherId, reversalDate, reason });
  const operation = async (tx: Prisma.TransactionClient) => {
    const prior = await tx.accountingVoucher.findUnique({
      where: { companyId_idempotencyKey: { companyId: context.companyId, idempotencyKey: key } },
    });
    if (prior) {
      if (prior.requestHash !== hash) throw new ConflictError("Idempotency-Key was used for a different reversal");
      return { voucher: prior, replayed: true };
    }
    const original = await tx.accountingVoucher.findFirst({
      where: { id: voucherId, companyId: context.companyId },
      include: {
        reversals: { select: { id: true } },
        lines: {
          orderBy: { lineNumber: "asc" },
          include: {
            taxDetails: true,
            billEntries: true,
            billDetails: true,
            costAllocations: true,
          },
        },
        inventoryMovements: {
          include: { batch: true },
        },
      },
    });
    if (!original) throw new NotFoundError("Voucher not found in the current company");
    if (original.status !== VoucherStatus.POSTED || original.reversals.length) {
      throw new ConflictError("Only an unreversed, posted voucher can be reversed");
    }
    const revDate = day(reversalDate);
    const financialYear = await resolveFinancialYear(tx, context.companyId, revDate);
    const series = await getOrCreateSeries(tx, context.companyId, original.type, financialYear);
    const voucherNumber = await allocateVoucherNumber(tx, series.id);
    const reversal = await tx.accountingVoucher.create({
      data: {
        companyId: context.companyId,
        voucherNumber,
        type: original.type,
        status: VoucherStatus.POSTED,
        approvalStatus: VoucherApprovalStatus.NOT_REQUIRED,
        voucherDate: revDate,
        financialYearId: financialYear?.id ?? null,
        numberSeriesId: series.id,
        narration: `Reversal of ${original.voucherNumber}: ${reason.trim()}`,
        idempotencyKey: key,
        requestHash: hash,
        postIdempotencyKey: key,
        postRequestHash: hash,
        reversalOfId: original.id,
        createdById: context.userId,
        postedById: context.userId,
        postedAt: new Date(),
      },
      select: { id: true, type: true, voucherNumber: true, voucherDate: true, narration: true },
    });
    const lines = await Promise.all(original.lines.map((line, index) => tx.voucherLine.create({
      data: {
        companyId: context.companyId,
        voucherId: reversal.id,
        ledgerId: line.ledgerId,
        lineNumber: index + 1,
        description: `Reversal · ${line.description ?? ""}`.slice(0, 240),
        debit: line.credit,
        credit: line.debit,
      },
      select: { id: true, ledgerId: true, debit: true, credit: true },
    })));
    for (const [index, originalLine] of original.lines.entries()) {
      const reversalLine = lines[index]!;
      await reverseVoucherBillEntries(tx, context.companyId, reversal.id, reversalLine.id, originalLine.billEntries, originalLine.billDetails);
      if (originalLine.taxDetails.length) {
        await tx.voucherTaxDetail.createMany({
          data: originalLine.taxDetails.map((tax) => ({
            companyId: context.companyId,
            voucherLineId: reversalLine.id,
            taxLedgerId: tax.taxLedgerId,
            taxType: tax.taxType,
            taxableAmount: tax.taxableAmount,
            taxAmount: tax.taxAmount,
            rate: tax.rate,
          })),
        });
      }
      if (originalLine.costAllocations.length) {
        await tx.costAllocation.createMany({
          data: originalLine.costAllocations.map((allocation) => ({
            companyId: context.companyId,
            voucherId: reversal.id,
            voucherLineId: reversalLine.id,
            costCentreId: allocation.costCentreId,
            amount: allocation.amount,
          })),
        });
      }
    }
    await tx.ledgerTransaction.createMany({
      data: lines.map((line) => ({
        companyId: context.companyId,
        voucherId: reversal.id,
        voucherLineId: line.id,
        ledgerId: line.ledgerId,
        transactionDate: revDate,
        debit: line.debit,
        credit: line.credit,
      })),
    });
    const taxRows = lines.flatMap((line, index) => original.lines[index]!.taxDetails.map((tax) => ({
      companyId: context.companyId,
      voucherId: reversal.id,
      voucherLineId: line.id,
      ledgerId: tax.taxLedgerId,
      taxType: tax.taxType,
      taxableAmount: tax.taxableAmount,
      taxAmount: tax.taxAmount,
      rate: tax.rate,
      transactionDate: revDate,
      isReversal: true,
    })));
    if (taxRows.length) await tx.taxTransaction.createMany({ data: taxRows });
    for (const movement of original.inventoryMovements) {
      const batch = movement.batch;
      await postInventoryMovement(tx, context, {
        itemId: movement.itemId,
        input: {
          warehouseId: movement.warehouseId,
          quantity: movement.quantity.toString(),
          unitCost: movement.unitCost.toString(),
          batchNumber: batch?.batchNumber ?? "",
          manufacturingDate: batch?.manufacturingDate ? dateText(batch.manufacturingDate) : "",
          expiryDate: batch?.expiryDate ? dateText(batch.expiryDate) : "",
        },
        date: reversalDate,
        type: reversedMovementType(movement.movementType),
        direction: movement.direction === InventoryDirection.IN ? InventoryDirection.OUT : InventoryDirection.IN,
        idempotencyKey: `${key}:stock:${movement.id}`,
        voucherId: reversal.id,
        requestInfo,
      });
    }
    await tx.accountingVoucher.update({
      where: { id: original.id },
      data: { status: VoucherStatus.REVERSED },
    });
    await appendVoucherHistory(
      tx, context, reversal, VoucherAuditAction.POSTED, DayBookEventType.POSTED,
      { status: "POSTED", voucherNumber, reversalOf: original.voucherNumber },
      requestInfo,
    );
    await appendVoucherHistory(
      tx, context, { ...original, status: VoucherStatus.REVERSED } as typeof original,
      VoucherAuditAction.REVERSED, DayBookEventType.REVERSED,
      { previousStatus: "POSTED", status: "REVERSED", reversalVoucherId: reversal.id, reversalNumber: voucherNumber, reason: reason.trim() },
      requestInfo,
    );
    return { voucher: reversal, replayed: false };
  };
  return transaction ? operation(transaction) : withTransaction(operation);
}

export { VoucherStatus, VoucherApprovalStatus };
