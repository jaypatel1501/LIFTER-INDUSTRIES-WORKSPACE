import {
  ledgerCreateSchema,
  ledgerGroupCreateSchema,
  partyCreateSchema,
} from "@/lib/validation/accounting";
import { COMPANY_PERMISSION_KEYS, OWNER_PERMISSIONS } from "@/lib/company-permissions";

describe("accounting master validation", () => {
  it("validates party tax identity and exact bill-wise opening totals", () => {
    const valid = partyCreateSchema.safeParse({
      type: "CUSTOMER",
      name: "Acme Traders",
      gstin: "27AAPFU0939F1ZV",
      pan: "AAPFU0939F",
      country: "India",
      creditPeriodDays: 30,
      creditLimit: "250000.00",
      openingBalance: {
        amount: "250.00",
        side: "DEBIT",
        date: "2026-04-01",
        bills: [{ referenceNumber: "INV-OPEN-01", dueDate: "2026-04-30", amount: "250.00" }],
      },
    });
    expect(valid.success).toBe(true);

    expect(partyCreateSchema.safeParse({
      type: "SUPPLIER",
      name: "Supplier One",
      gstin: "bad",
      openingBalance: {
        amount: "100.00",
        side: "CREDIT",
        date: "2026-04-01",
        bills: [{ referenceNumber: "BILL-1", dueDate: "2026-04-30", amount: "99.99" }],
      },
    }).success).toBe(false);
  });

  it("compares large bill-wise values without floating-point rounding", () => {
    expect(partyCreateSchema.safeParse({
      type: "CUSTOMER",
      name: "Large Balance",
      openingBalance: {
        amount: "9007199254740993.01",
        side: "DEBIT",
        date: "2026-04-01",
        bills: [
          { referenceNumber: "LARGE-1", dueDate: "2026-04-30", amount: "9007199254740993.00" },
          { referenceNumber: "LARGE-2", dueDate: "2026-04-30", amount: "0.01" },
        ],
      },
    }).success).toBe(true);
    expect(partyCreateSchema.safeParse({
      type: "CUSTOMER",
      name: "Invalid Amount",
      openingBalance: {
        amount: "invalid",
        side: "DEBIT",
        date: "2026-04-01",
        bills: [{ referenceNumber: "INVALID", dueDate: "2026-04-30", amount: "NaN" }],
      },
    }).success).toBe(false);
  });

  it("validates ledger types, account flags and group hierarchy inputs", () => {
    expect(ledgerCreateSchema.safeParse({
      name: "Main Bank Account",
      groupId: "bank-group-id",
      code: "MAIN-BANK",
      type: "BANK",
      costCentreEnabled: true,
      interestEnabled: true,
      interestRate: "6.2500",
      openingBalance: { amount: "0", side: "DEBIT", date: "2026-04-01" },
    }).success).toBe(true);
    expect(ledgerCreateSchema.safeParse({
      name: "Missing Rate",
      groupId: "group-id",
      type: "GENERAL",
      interestEnabled: true,
      interestRate: "",
    }).success).toBe(false);
    expect(ledgerGroupCreateSchema.safeParse({
      name: "Regional Assets",
      code: "REGIONAL_ASSETS",
      nature: "ASSET",
      parentId: null,
    }).success).toBe(true);
  });

  it("grants owners the new accounting actions for existing and new companies", () => {
    for (const permission of [
      "parties:create", "parties:update", "ledgers:create", "ledger-groups:manage",
      "vouchers:read",
    ]) {
      expect(COMPANY_PERMISSION_KEYS.has(permission)).toBe(true);
    }
    expect(OWNER_PERMISSIONS).toHaveLength(COMPANY_PERMISSION_KEYS.size);
  });
});
