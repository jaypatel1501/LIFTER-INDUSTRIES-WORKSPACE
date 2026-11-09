import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";

const alphaNumeric = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const unionTerritoryStateCodes = new Set(["04", "26", "31", "35", "38"]);
const decimal = (value: string | number) => new Prisma.Decimal(value);
const cents = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export function isUnionTerritoryGSTState(stateCode: string | null | undefined) {
  return unionTerritoryStateCodes.has(stateCode ?? "");
}

export const gstinSchema = z.string().trim().toUpperCase().regex(
  /^(0[1-9]|[1-2][0-9]|3[0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
).refine((gstin) => {
  let factor = 2;
  let sum = 0;
  for (let index = 13; index >= 0; index -= 1) {
    const product = alphaNumeric.indexOf(gstin[index]!) * factor;
    sum += Math.floor(product / 36) + (product % 36);
    factor = factor === 2 ? 1 : 2;
  }
  return gstin[14] === alphaNumeric[(36 - (sum % 36)) % 36]!;
}, "GSTIN checksum is invalid");

export const hsnSacSchema = z.string().trim().regex(
  /^(?:\d{4}|\d{6}|\d{8}|99\d{4})$/,
  "Enter a 4, 6, or 8 digit HSN, or a six digit SAC beginning with 99",
);

export type GSTCalculationInput = {
  unitRate: string;
  quantity: string;
  gstRate: string;
  cessRate?: string | undefined;
  discountPercent?: string | undefined;
  isTaxInclusive?: boolean | undefined;
  reverseCharge?: boolean | undefined;
  companyStateCode: string;
  placeOfSupplyStateCode: string;
};

export function calculateGST(input: GSTCalculationInput) {
  const gstRate = decimal(input.gstRate);
  const cessRate = decimal(input.cessRate ?? "0");
  if (gstRate.isNegative() || cessRate.isNegative() || gstRate.greaterThan(100) || cessRate.greaterThan(100)) {
    throw new ValidationError("GST and cess rates must be between 0 and 100");
  }
  const unitRate = decimal(input.unitRate);
  const quantity = decimal(input.quantity);
  if (unitRate.isNegative() || quantity.lessThanOrEqualTo(0)) {
    throw new ValidationError("Unit rate cannot be negative and quantity must be greater than zero");
  }
  const gross = cents(unitRate.mul(quantity));
  const discount = decimal(input.discountPercent ?? "0");
  if (discount.isNegative() || discount.greaterThan(100)) {
    throw new ValidationError("Discount percentage must be between 0 and 100");
  }
  const discountedGross = cents(gross.minus(gross.mul(discount).div(100)));
  const combinedRate = gstRate.plus(cessRate);
  const taxableAmount = input.isTaxInclusive
    ? cents(discountedGross.div(decimal(1).plus(combinedRate.div(100))))
    : discountedGross;

  const totalGst = cents(taxableAmount.mul(gstRate).div(100));
  const cessAmount = cents(taxableAmount.mul(cessRate).div(100));
  const intraState = Boolean(input.companyStateCode && input.placeOfSupplyStateCode &&
    input.companyStateCode === input.placeOfSupplyStateCode);
  const unionTerritory = isUnionTerritoryGSTState(input.companyStateCode);
  let cgstAmount = decimal(0);
  let sgstAmount = decimal(0);
  let utgstAmount = decimal(0);
  let igstAmount = decimal(0);
  if (!intraState) {
    igstAmount = totalGst;
  } else {
    cgstAmount = totalGst.div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    if (unionTerritory) utgstAmount = totalGst.minus(cgstAmount);
    else sgstAmount = totalGst.minus(cgstAmount);
  }

  const taxAmount = cents(totalGst.plus(cessAmount));
  const reverseCharge = input.reverseCharge ?? false;
  const supplierTaxAmount = reverseCharge ? decimal(0) : taxAmount;
  return {
    taxableAmount: taxableAmount.toFixed(2),
    cgstAmount: cgstAmount.toFixed(2),
    sgstAmount: sgstAmount.toFixed(2),
    utgstAmount: utgstAmount.toFixed(2),
    igstAmount: igstAmount.toFixed(2),
    cessAmount: cessAmount.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    supplierTaxAmount: supplierTaxAmount.toFixed(2),
    totalAmount: cents(taxableAmount.plus(supplierTaxAmount)).toFixed(2),
    reverseChargeTaxAmount: reverseCharge ? taxAmount.toFixed(2) : "0.00",
    supplyType: intraState ? (unionTerritory ? "INTRA_UT" : "INTRA_STATE") : "INTER_STATE",
  } as const;
}

export function gstPeriodBounds(periodKey: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periodKey);
  if (!match) throw new ValidationError("GST period must be in YYYY-MM format");
  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}
