import { ValidationError } from "@/lib/errors";

function toCents(value: string) {
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) {
    throw new ValidationError("Voucher amounts must be non-negative values with at most two decimal places");
  }
  const [units, fraction = ""] = value.split(".");
  return BigInt(units!) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

export function assertBalancedVoucher(lines: readonly { debit: string; credit: string }[]) {
  const totals = lines.reduce((sum, line) => ({
    debit: sum.debit + toCents(line.debit),
    credit: sum.credit + toCents(line.credit),
  }), { debit: BigInt(0), credit: BigInt(0) });
  if (totals.debit <= BigInt(0) || totals.debit !== totals.credit) {
    throw new ValidationError("Posted voucher debits must equal credits and total more than zero");
  }
  return totals;
}
