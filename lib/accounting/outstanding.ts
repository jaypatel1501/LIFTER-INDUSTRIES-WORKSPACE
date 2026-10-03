import { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

type Database = Prisma.TransactionClient | Prisma.DefaultPrismaClient;
type OpenBillQuery = { ledgerId?: string | undefined; partyId?: string | undefined; search?: string | undefined; page: number; pageSize: number };

export async function listOpenBills(database: Database, companyId: string, query: OpenBillQuery) {
  const partyFilter = query.partyId ? { ledger: { partyId: query.partyId } } : {};
  const ledgerFilter = query.ledgerId ? { ledgerId: query.ledgerId } : {};
  const searchFilter = query.search ? { OR: [
    { referenceNumber: { contains: query.search, mode: "insensitive" as const } },
    { voucher: { voucherNumber: { contains: query.search, mode: "insensitive" as const } } },
    { voucherLine: { ledger: { party: { name: { contains: query.search, mode: "insensitive" as const } } } } },
  ] } : {};
  const entryWhere: Prisma.BillWiseEntryWhereInput = {
    companyId, referenceType: "NEW", remainingAmount: { gt: 0 },
    voucher: { status: "POSTED" }, voucherLine: { ...ledgerFilter, ...partyFilter }, ...searchFilter,
  };
  const openingWhere: Prisma.BillWiseOpeningWhereInput = {
    companyId, remainingAmount: { gt: 0 }, voucherLine: { ...ledgerFilter, ...partyFilter,
      voucher: { status: "POSTED" },
    },
    ...(query.search ? { referenceNumber: { contains: query.search, mode: "insensitive" } } : {}),
  };
  const take = query.page * query.pageSize;
  const [entries, entryTotal, openings, openingTotal] = await Promise.all([
    database.billWiseEntry.findMany({ where: entryWhere, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take,
      select: { id: true, referenceNumber: true, dueDate: true, amount: true, remainingAmount: true,
        voucher: { select: { id: true, voucherNumber: true, voucherDate: true } },
        voucherLine: { select: { ledgerId: true, ledger: { select: { party: { select: { id: true, name: true, type: true } } } } } } } }),
    database.billWiseEntry.count({ where: entryWhere }),
    database.billWiseOpening.findMany({ where: openingWhere, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take,
      select: { id: true, referenceNumber: true, dueDate: true, amount: true, remainingAmount: true,
        voucherLine: { select: {
          ledgerId: true,
          voucher: { select: { id: true, voucherNumber: true, voucherDate: true } },
          ledger: { select: { party: { select: { id: true, name: true, type: true } } } },
        } },
      } }),
    database.billWiseOpening.count({ where: openingWhere }),
  ]);
  const bills = [
    ...entries.map((entry) => ({ kind: "ENTRY" as const, id: entry.id, referenceNumber: entry.referenceNumber ?? "",
      dueDate: entry.dueDate?.toISOString().slice(0, 10) ?? null, amount: entry.amount.toString(), remainingAmount: entry.remainingAmount.toString(),
      ledgerId: entry.voucherLine.ledgerId, party: entry.voucherLine.ledger.party,
      voucher: { id: entry.voucher.id, number: entry.voucher.voucherNumber, date: entry.voucher.voucherDate.toISOString().slice(0, 10) } })),
    ...openings.map((opening) => ({ kind: "OPENING" as const, id: opening.id, referenceNumber: opening.referenceNumber,
      dueDate: opening.dueDate.toISOString().slice(0, 10), amount: opening.amount.toString(), remainingAmount: opening.remainingAmount.toString(),
      ledgerId: opening.voucherLine.ledgerId, party: opening.voucherLine.ledger.party,
      voucher: { id: opening.voucherLine.voucher.id, number: opening.voucherLine.voucher.voucherNumber, date: opening.voucherLine.voucher.voucherDate.toISOString().slice(0, 10) } })),
  ].sort((left, right) => (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31") || left.id.localeCompare(right.id));
  const start = (query.page - 1) * query.pageSize;
  return { bills: bills.slice(start, start + query.pageSize), total: entryTotal + openingTotal, page: query.page, pageSize: query.pageSize };
}

export async function validateBillAllocations(
  tx: Prisma.TransactionClient,
  companyId: string,
  lines: readonly { ledgerId: string; debit: string; credit: string; bills: readonly { referenceType: string; referenceNumber?: string | undefined; amount: string; billEntryId?: string | undefined; openingBillId?: string | undefined }[] }[],
) {
  for (const line of lines) {
    for (const bill of line.bills) {
      if (bill.referenceType !== "AGAINST_REF") continue;
      const source = bill.billEntryId
        ? await tx.billWiseEntry.findFirst({ where: { id: bill.billEntryId, companyId, referenceType: "NEW", remainingAmount: { gt: 0 }, voucher: { status: "POSTED" } },
            select: { id: true, referenceNumber: true, remainingAmount: true, voucherLine: { select: { ledgerId: true, ledger: { select: { party: { select: { type: true } } } } } } } })
        : null;
      const opening = bill.openingBillId
        ? await tx.billWiseOpening.findFirst({ where: { id: bill.openingBillId, companyId, remainingAmount: { gt: 0 }, voucherLine: { voucher: { status: "POSTED" } } },
            select: { id: true, referenceNumber: true, remainingAmount: true, voucherLine: { select: { ledgerId: true, ledger: { select: { party: { select: { type: true } } } } } } } })
        : null;
      const target = source ?? opening;
      if (!target) throw new NotFoundError("The selected open bill is no longer available in this company");
      if (target.voucherLine.ledgerId !== line.ledgerId) throw new ValidationError("A bill can only be settled through its linked party ledger");
      if (bill.referenceNumber !== target.referenceNumber) throw new ValidationError("Bill reference does not match the selected open bill");
      const partyType = target.voucherLine.ledger.party?.type;
      if (!partyType) throw new ValidationError("Bill settlements require a customer or supplier party ledger");
      if ((partyType === "CUSTOMER" && (Number(line.credit) <= 0 || Number(line.debit) > 0)) ||
          (partyType === "SUPPLIER" && (Number(line.debit) <= 0 || Number(line.credit) > 0))) {
        throw new ValidationError(partyType === "CUSTOMER" ? "Customer bills are settled by crediting the customer ledger" : "Supplier bills are settled by debiting the supplier ledger");
      }
      if (new Prisma.Decimal(bill.amount).greaterThan(target.remainingAmount)) {
        throw new ConflictError(`Settlement exceeds the open amount for ${target.referenceNumber}`);
      }
    }
  }
}

export async function applyBillSettlements(
  tx: Prisma.TransactionClient,
  companyId: string,
  entries: readonly { referenceType: string; amount: Prisma.Decimal; settlesEntryId: string | null; settlesOpeningId: string | null }[],
) {
  for (const entry of entries) {
    if (entry.referenceType !== "AGAINST_REF") continue;
    const amount = entry.amount;
    const updated = entry.settlesEntryId
      ? await tx.billWiseEntry.updateMany({ where: { id: entry.settlesEntryId, companyId, remainingAmount: { gte: amount } },
          data: { settledAmount: { increment: amount }, remainingAmount: { decrement: amount } } })
      : entry.settlesOpeningId
        ? await tx.billWiseOpening.updateMany({ where: { id: entry.settlesOpeningId, companyId, remainingAmount: { gte: amount } },
            data: { settledAmount: { increment: amount }, remainingAmount: { decrement: amount } } })
        : { count: 0 };
    if (updated.count !== 1) throw new ConflictError("Open bill balance changed while posting; retry with current allocations");
  }
}
