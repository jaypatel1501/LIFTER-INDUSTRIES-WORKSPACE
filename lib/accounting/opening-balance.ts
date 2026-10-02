import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { ensureDefaultChart } from "@/lib/accounting/default-chart";
import { createPostedVoucherWithinTransaction } from "@/lib/accounting/voucher-platform";
import { hashIdempotencyKey } from "@/lib/idempotency";
import { withTransaction } from "@/lib/transactions";
import type { ledgerCreateSchema, partyCreateSchema } from "@/lib/validation/accounting";
import type { z } from "zod";

type PartyInput = z.infer<typeof partyCreateSchema>;
type LedgerInput = z.infer<typeof ledgerCreateSchema>;
type CompanyActor = { companyId: string; userId: string };
type RequestInfo = { ipAddress?: string | undefined; userAgent?: string | undefined };

function requestHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function amount(value: string) {
  return new Prisma.Decimal(value);
}

function openingDate(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

async function postOpeningVoucher(
  tx: Prisma.TransactionClient,
  options: {
    companyId: string;
    actorId: string;
    ledgerId: string;
    amount: string;
    side: "DEBIT" | "CREDIT";
    date: string;
    key: string;
    payloadHash: string;
    bills?: { referenceNumber: string; dueDate: string; amount: string }[];
    description: string;
  },
) {
  const value = amount(options.amount);
  if (value.isZero()) return null;
  const date = openingDate(options.date);
  const company = await tx.company.findUniqueOrThrow({
    where: { id: options.companyId },
    select: { booksBeginningDate: true },
  });
  const dateText = options.date;
  const companyBooksDate = company.booksBeginningDate?.toISOString().slice(0, 10);
  if (companyBooksDate && companyBooksDate !== dateText) {
    throw new ValidationError("Opening balance date must match the company books-beginning date");
  }
  const [financialYearCount, financialYear] = await Promise.all([
    tx.financialYear.count({ where: { companyId: options.companyId } }),
    tx.financialYear.findFirst({
      where: {
        companyId: options.companyId,
        startDate: { lte: date },
        endDate: { gte: date },
      },
      orderBy: { startDate: "desc" },
      select: { id: true, status: true, booksBeginningDate: true },
    }),
  ]);
  if (financialYearCount > 0 && !financialYear) {
    throw new ValidationError("Opening balance date must fall within a configured financial year");
  }
  if (financialYear?.status === "CLOSED") throw new ConflictError("Opening entries cannot be posted in a closed financial year");
  const financialYearBooksDate = financialYear?.booksBeginningDate.toISOString().slice(0, 10);
  if (companyBooksDate && financialYearBooksDate && financialYearBooksDate !== dateText) {
    throw new ValidationError("Opening balance date must match the financial year's books-beginning date");
  }
  if (!companyBooksDate && financialYearBooksDate && financialYearBooksDate !== dateText) {
    throw new ValidationError("Opening balance date must match the financial year's books-beginning date");
  }

  const chart = await ensureDefaultChart(tx, options.companyId);
  const debit = options.side === "DEBIT" ? value : new Prisma.Decimal(0);
  const credit = options.side === "CREDIT" ? value : new Prisma.Decimal(0);
  const counterpartDebit = debit.isZero() ? value : new Prisma.Decimal(0);
  const counterpartCredit = credit.isZero() ? value : new Prisma.Decimal(0);
  const voucher = await createPostedVoucherWithinTransaction(
    tx,
    { companyId: options.companyId, userId: options.actorId },
    {
      type: "OPENING_BALANCE",
      voucherDate: options.date,
      narration: `Opening balance · ${options.description}`,
      idempotencyKey: options.key,
      requestHash: options.payloadHash,
      lines: [
        {
          ledgerId: options.ledgerId,
          description: `Opening ${options.side.toLowerCase()} balance`,
          debit: debit.toString(),
          credit: credit.toString(),
        },
        {
          ledgerId: chart.openingLedgerId,
          description: "Opening balance offset",
          debit: counterpartDebit.toString(),
          credit: counterpartCredit.toString(),
        },
      ],
      legacyBills: (options.bills ?? []).map((bill) => ({
        lineIndex: 0,
        ...bill,
      })),
    },
  );
  return voucher.id;
}

export async function createPartyWithOpeningBalance(
  context: CompanyActor,
  input: PartyInput,
  idempotencyHeader: string | null,
  requestInfo: RequestInfo,
) {
  if (!idempotencyHeader) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(idempotencyHeader);
  const payloadHash = requestHash(input);
  return withTransaction(async (tx) => {
    const existing = await tx.party.findUnique({
      where: { companyId_creationKey: { companyId: context.companyId, creationKey: key } },
      include: { ledger: { include: { group: { select: { id: true, name: true, code: true } } } } },
    });
    if (existing) {
      if (existing.creationHash !== payloadHash) throw new ConflictError("Idempotency-Key was already used for a different request");
      return { party: existing, replayed: true };
    }
    const chart = await ensureDefaultChart(tx, context.companyId);
    const groupCode = input.type === "CUSTOMER" ? "SUNDRY_DEBTORS" : "SUNDRY_CREDITORS";
    const groupId = chart.groups.get(groupCode);
    if (!groupId) throw new Error(`Default party group ${groupCode} is not configured`);
    const partyRecord = await tx.party.create({
      data: {
        companyId: context.companyId,
        type: input.type,
        name: input.name,
        contactName: input.contactName || null,
        email: input.email || null,
        phone: input.phone || null,
        mobile: input.mobile || null,
        gstin: input.gstin || null,
        pan: input.pan || null,
        addressLine1: input.addressLine1 || null,
        addressLine2: input.addressLine2 || null,
        city: input.city || null,
        state: input.state || null,
        stateCode: input.stateCode || null,
        postalCode: input.postalCode || null,
        country: input.country,
        creditPeriodDays: input.creditPeriodDays,
        creditLimit: amount(input.creditLimit),
        creationKey: key,
        creationHash: payloadHash,
      },
      select: { id: true },
    });
    await tx.ledger.create({
      data: {
        companyId: context.companyId,
        groupId,
        partyId: partyRecord.id,
        name: input.name,
        type: "PARTY",
        creationKey: key,
        creationHash: payloadHash,
      },
    });
    const party = await tx.party.findUniqueOrThrow({
      where: { id: partyRecord.id },
      include: { ledger: { include: { group: { select: { id: true, name: true, code: true } } } } },
    });
    if (!party.ledger) throw new Error("Party ledger was not created");
    const opening = input.openingBalance;
    const voucherId = opening
      ? await postOpeningVoucher(tx, {
          companyId: context.companyId,
          actorId: context.userId,
          ledgerId: party.ledger.id,
          amount: opening.amount,
          side: opening.side,
          date: opening.date,
          key,
          payloadHash,
          bills: opening.bills,
          description: party.name,
        })
      : null;
    await writeAuditLog({
      companyId: context.companyId,
      actorId: context.userId,
      action: "PARTY_CREATED",
      entityType: "Party",
      entityId: party.id,
      changes: {
        type: party.type,
        name: party.name,
        linkedLedgerId: party.ledger.id,
        openingVoucherId: voucherId,
      },
      ...requestInfo,
    }, tx);
    if (voucherId) {
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "OPENING_BALANCE_POSTED",
        entityType: "AccountingVoucher",
        entityId: voucherId,
        changes: { partyId: party.id, ledgerId: party.ledger.id, amount: opening!.amount, side: opening!.side },
        ...requestInfo,
      }, tx);
    }
    return { party, replayed: false };
  });
}

export async function createLedgerWithOpeningBalance(
  context: CompanyActor,
  input: LedgerInput,
  idempotencyHeader: string | null,
  requestInfo: RequestInfo,
) {
  if (!idempotencyHeader) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(idempotencyHeader);
  const payloadHash = requestHash(input);
  return withTransaction(async (tx) => {
    const existing = await tx.ledger.findUnique({
      where: { companyId_creationKey: { companyId: context.companyId, creationKey: key } },
      include: { group: { select: { id: true, name: true, code: true } } },
    });
    if (existing) {
      if (existing.creationHash !== payloadHash) throw new ConflictError("Idempotency-Key was already used for a different request");
      return { ledger: existing, replayed: true };
    }
    const group = await tx.ledgerGroup.findFirst({
      where: { id: input.groupId, companyId: context.companyId },
      select: { id: true, nature: true },
    });
    if (!group) throw new NotFoundError("Ledger group not found in the active company");
    if (input.type === "INCOME" && group.nature !== "INCOME") {
      throw new ValidationError("Income ledgers must belong to an income group");
    }
    if (input.type === "EXPENSE" && group.nature !== "EXPENSE") {
      throw new ValidationError("Expense ledgers must belong to an expense group");
    }
    if (["CASH", "BANK"].includes(input.type) && group.nature !== "ASSET") {
      throw new ValidationError("Cash and bank ledgers must belong to an asset group");
    }
    const ledger = await tx.ledger.create({
      data: {
        companyId: context.companyId,
        groupId: group.id,
        name: input.name,
        code: input.code || null,
        type: input.type,
        costCentreEnabled: input.costCentreEnabled,
        interestEnabled: input.interestEnabled,
        interestRate: input.interestEnabled ? new Prisma.Decimal(input.interestRate!) : null,
        creationKey: key,
        creationHash: payloadHash,
      },
      include: { group: { select: { id: true, name: true, code: true } } },
    });
    const opening = input.openingBalance;
    const voucherId = opening
      ? await postOpeningVoucher(tx, {
          companyId: context.companyId,
          actorId: context.userId,
          ledgerId: ledger.id,
          amount: opening.amount,
          side: opening.side,
          date: opening.date,
          key,
          payloadHash,
          description: ledger.name,
        })
      : null;
    await writeAuditLog({
      companyId: context.companyId,
      actorId: context.userId,
      action: "LEDGER_CREATED",
      entityType: "Ledger",
      entityId: ledger.id,
      changes: { name: ledger.name, type: ledger.type, groupId: ledger.groupId, openingVoucherId: voucherId },
      ...requestInfo,
    }, tx);
    if (voucherId) {
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "OPENING_BALANCE_POSTED",
        entityType: "AccountingVoucher",
        entityId: voucherId,
        changes: { ledgerId: ledger.id, amount: opening!.amount, side: opening!.side },
        ...requestInfo,
      }, tx);
    }
    return { ledger, replayed: false };
  });
}
