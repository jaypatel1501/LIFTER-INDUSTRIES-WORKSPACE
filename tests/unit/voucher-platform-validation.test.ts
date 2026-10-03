import { voucherDraftSchema } from "@/lib/validation/vouchers";
import { assertBalancedVoucher } from "@/lib/accounting/voucher-validation";
import { ValidationError } from "@/lib/errors";

const validDraft = {
  type: "JOURNAL",
  voucherDate: "2026-10-02",
  narration: "Monthly accrual",
  lines: [
    { ledgerId: "cash", debit: "1250.50", credit: "0.00", bills: [], taxes: [], costAllocations: [] },
    { ledgerId: "expense", debit: "0.00", credit: "1250.50", bills: [], taxes: [], costAllocations: [] },
  ],
};

describe("voucher posting validation", () => {
  it("accepts a valid bilingual-independent voucher draft and defaults optional detail collections", () => {
    const result = voucherDraftSchema.parse(validDraft);
    expect(result.lines).toHaveLength(2);
    expect(result.attachments).toEqual([]);
  });

  it("rejects a line with both debit and credit amounts", () => {
    const result = voucherDraftSchema.safeParse({
      ...validDraft,
      lines: [{ ...validDraft.lines[0], debit: "10.00", credit: "10.00" }, validDraft.lines[1]],
    });
    expect(result.success).toBe(false);
  });

  it("requires bill references except for on-account allocations", () => {
    const result = voucherDraftSchema.safeParse({
      ...validDraft,
      lines: [
        { ...validDraft.lines[0], bills: [{ referenceType: "NEW", referenceNumber: "", amount: "10.00" }] },
        validDraft.lines[1],
      ],
    });
    expect(result.success).toBe(false);
  });

  it("requires electronic and cheque references and an exact open-bill target", () => {
    const payment = {
      ...validDraft,
      type: "PAYMENT",
      paymentMethod: "UPI",
      paymentDate: "2026-10-02",
      lines: [
        { ...validDraft.lines[0], debit: "100.00" },
        { ...validDraft.lines[1], debit: "0.00", credit: "100.00" },
      ],
    };
    expect(voucherDraftSchema.safeParse(payment).success).toBe(false);
    expect(voucherDraftSchema.safeParse({ ...payment, paymentReference: "UPI-TRANSACTION-8" }).success).toBe(true);
    expect(voucherDraftSchema.safeParse({ ...payment, paymentReference: "", lines: [
      { ...payment.lines[0], bills: [{ referenceType: "AGAINST_REF", referenceNumber: "SUP-INV-1", amount: "50.00" }] },
      payment.lines[1],
    ] }).success).toBe(false);
    expect(voucherDraftSchema.safeParse({ ...payment, paymentReference: "UPI-TRANSACTION-9", lines: [
      { ...payment.lines[0], bills: [{ referenceType: "AGAINST_REF", referenceNumber: "SUP-INV-1", billEntryId: "open-bill-1", amount: "50.00" }] },
      payment.lines[1],
    ] }).success).toBe(true);
  });

  it("rejects an inventory batch whose expiry precedes manufacturing", () => {
    const result = voucherDraftSchema.safeParse({
      ...validDraft,
      lines: [
        { ...validDraft.lines[0], stock: { itemId: "item", warehouseId: "warehouse", batchNumber: "A1", manufacturingDate: "2026-10-03", expiryDate: "2026-10-02", movementType: "PURCHASE", direction: "IN", quantity: "2", unitCost: "10" } },
        validDraft.lines[1],
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects stock movement direction that conflicts with its movement type", () => {
    const result = voucherDraftSchema.safeParse({
      ...validDraft,
      lines: [
        { ...validDraft.lines[0], stock: { itemId: "item", warehouseId: "warehouse", movementType: "SALES", direction: "IN", quantity: "2", unitCost: "10" } },
        validDraft.lines[1],
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts exact equal totals without floating-point rounding", () => {
    expect(assertBalancedVoucher([
      { debit: "9007199254740991.99", credit: "0" },
      { debit: "0", credit: "9007199254740991.99" },
    ])).toEqual({ debit: BigInt("900719925474099199"), credit: BigInt("900719925474099199") });
  });

  it.each([
    { lines: [{ debit: "10.01", credit: "10.00" }] },
    { lines: [{ debit: "0", credit: "0" }] },
    { lines: [{ debit: "-1", credit: "-1" }] },
    { lines: [{ debit: "1.001", credit: "1.001" }] },
  ])("rejects unbalanced or invalid posted values", ({ lines }) => {
    expect(() => assertBalancedVoucher(lines)).toThrow(ValidationError);
  });
});
