import type { Prisma } from "@prisma/client";

export const DEFAULT_LEDGER_GROUPS = [
  { code: "CAPITAL", name: "Capital Account", nature: "EQUITY", parent: null },
  { code: "RESERVES", name: "Reserves & Surplus", nature: "EQUITY", parent: "CAPITAL" },
  { code: "LOANS", name: "Loans (Liability)", nature: "LIABILITY", parent: null },
  { code: "SECURED_LOANS", name: "Secured Loans", nature: "LIABILITY", parent: "LOANS" },
  { code: "UNSECURED_LOANS", name: "Unsecured Loans", nature: "LIABILITY", parent: "LOANS" },
  { code: "CURRENT_LIABILITIES", name: "Current Liabilities", nature: "LIABILITY", parent: null },
  { code: "SUNDRY_CREDITORS", name: "Sundry Creditors", nature: "LIABILITY", parent: "CURRENT_LIABILITIES" },
  { code: "DUTIES_TAXES", name: "Duties & Taxes", nature: "LIABILITY", parent: "CURRENT_LIABILITIES" },
  { code: "FIXED_ASSETS", name: "Fixed Assets", nature: "ASSET", parent: null },
  { code: "INVESTMENTS", name: "Investments", nature: "ASSET", parent: null },
  { code: "CURRENT_ASSETS", name: "Current Assets", nature: "ASSET", parent: null },
  { code: "SUNDRY_DEBTORS", name: "Sundry Debtors", nature: "ASSET", parent: "CURRENT_ASSETS" },
  { code: "CASH_IN_HAND", name: "Cash-in-Hand", nature: "ASSET", parent: "CURRENT_ASSETS" },
  { code: "BANK_ACCOUNTS", name: "Bank Accounts", nature: "ASSET", parent: "CURRENT_ASSETS" },
  { code: "STOCK_IN_HAND", name: "Stock-in-Hand", nature: "ASSET", parent: "CURRENT_ASSETS" },
  { code: "DIRECT_INCOME", name: "Direct Incomes", nature: "INCOME", parent: null },
  { code: "INDIRECT_INCOME", name: "Indirect Incomes", nature: "INCOME", parent: null },
  { code: "DIRECT_EXPENSES", name: "Direct Expenses", nature: "EXPENSE", parent: null },
  { code: "INDIRECT_EXPENSES", name: "Indirect Expenses", nature: "EXPENSE", parent: null },
] as const;

export async function ensureDefaultChart(
  tx: Prisma.TransactionClient,
  companyId: string,
) {
  const groups = new Map<string, string>();
  for (const group of DEFAULT_LEDGER_GROUPS) {
    const created = await tx.ledgerGroup.upsert({
      where: { companyId_code: { companyId, code: group.code } },
      create: {
        companyId,
        name: group.name,
        code: group.code,
        nature: group.nature,
        isSystem: true,
        parentId: group.parent ? groups.get(group.parent)! : null,
      },
      update: {},
      select: { id: true },
    });
    groups.set(group.code, created.id);
  }
  const openingLedger = await tx.ledger.upsert({
    where: { companyId_code: { companyId, code: "OPENING_BALANCE_DIFFERENCE" } },
    create: {
      companyId,
      groupId: groups.get("CAPITAL")!,
      name: "Opening Balance Difference",
      code: "OPENING_BALANCE_DIFFERENCE",
      type: "GENERAL",
      isSystem: true,
      creationKey: "system:opening-balance-difference",
      creationHash: "system",
    },
    update: {},
    select: { id: true },
  });
  const stockGroupId = groups.get("STOCK_IN_HAND");
  if (!stockGroupId) throw new Error("Default stock group is not configured");
  const inventoryLedger = await tx.ledger.upsert({
    where: { companyId_code: { companyId, code: "STOCK_ON_HAND" } },
    create: {
      companyId,
      groupId: stockGroupId,
      name: "Stock on Hand",
      code: "STOCK_ON_HAND",
      type: "GENERAL",
      isSystem: true,
      creationKey: "system:stock-on-hand",
      creationHash: "system",
    },
    update: {},
    select: { id: true },
  });
  return { groups, openingLedgerId: openingLedger.id, inventoryLedgerId: inventoryLedger.id };
}
