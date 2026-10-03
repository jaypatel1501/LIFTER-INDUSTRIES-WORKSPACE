import { createHash } from "node:crypto";
import { Prisma, type SalesDocumentType } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { createPostedVoucherWithinTransaction, reversePostedVoucher } from "@/lib/accounting/voucher-platform";
import { ensureDefaultChart } from "@/lib/accounting/default-chart";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashIdempotencyKey } from "@/lib/idempotency";
import { postInventoryMovement } from "@/lib/inventory/post-movement";
import { withTransaction } from "@/lib/transactions";
import type { salesDocumentCreateSchema, salesConvertSchema } from "@/lib/validation/sales";
import type { z } from "zod";

type Actor = { companyId: string; userId: string };
type RequestInfo = { ipAddress?: string | undefined; userAgent?: string | undefined };
type CreateInput = z.infer<typeof salesDocumentCreateSchema>;
type ConvertInput = z.infer<typeof salesConvertSchema>;
type SalesLine = {
  itemId?: string | undefined;
  sourceLineId?: string | undefined;
  description: string;
  unit: string;
  quantity: string;
  unitRate: string;
  discountPercent?: string | undefined;
  warehouseId?: string | undefined;
  batchNumber?: string | undefined;
  manufacturingDate?: string | undefined;
  expiryDate?: string | undefined;
  gstRate?: string | undefined;
};

const decimal = (value: string | number) => new Prisma.Decimal(value);
const cents = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const inputJson = (value: object): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function fiscalKey(value: Date) {
  const year = value.getUTCFullYear();
  const fiscalStart = value.getUTCMonth() >= 3 ? year : year - 1;
  return `${fiscalStart}-${String(fiscalStart + 1).slice(-2)}`;
}

async function nextNumber(tx: Prisma.TransactionClient, companyId: string, type: SalesDocumentType, documentDate: Date) {
  const periodKey = fiscalKey(documentDate);
  const prefixByType: Record<SalesDocumentType, string> = {
    QUOTATION: "QUO",
    SALES_ORDER: "SO",
    DELIVERY_NOTE: "DN",
    SALES_INVOICE: "INV",
  };
  const series = await tx.salesNumberSeries.upsert({
    where: { companyId_documentType_periodKey: { companyId, documentType: type, periodKey } },
    create: { companyId, documentType: type, periodKey, prefix: `${prefixByType[type]}-${periodKey}-` },
    update: {},
    select: { id: true, prefix: true, suffix: true, padding: true, nextNumber: true, isActive: true },
  });
  if (!series.isActive) throw new ConflictError("The sales number series for this financial year is inactive");
  const allocated = await tx.salesNumberSeries.update({
    where: { id: series.id },
    data: { nextNumber: { increment: 1 } },
    select: { nextNumber: true },
  });
  return {
    seriesId: series.id,
    number: `${series.prefix}${String(allocated.nextNumber - 1).padStart(series.padding, "0")}${series.suffix}`,
  };
}

async function validateSalesDate(tx: Prisma.TransactionClient, companyId: string, documentDate: Date) {
  const [periodCount, financialYear, company] = await Promise.all([
    tx.financialYear.count({ where: { companyId } }),
    tx.financialYear.findFirst({
      where: { companyId, startDate: { lte: documentDate }, endDate: { gte: documentDate } },
      select: { status: true, booksBeginningDate: true },
    }),
    tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { booksBeginningDate: true } }),
  ]);
  if (periodCount > 0 && !financialYear) {
    throw new ValidationError("Sales document date must fall within a configured financial year");
  }
  if (financialYear?.status === "CLOSED") throw new ConflictError("Sales documents cannot be created in a closed financial year");
  const booksDate = financialYear?.booksBeginningDate ?? company.booksBeginningDate;
  if (booksDate && documentDate < booksDate) {
    throw new ValidationError("Sales document date cannot be before the books-beginning date");
  }
}

function taxesForLine(
  taxable: Prisma.Decimal,
  rate: Prisma.Decimal,
  intraState: boolean,
  unionTerritory: boolean,
) {
  if (!intraState) {
    return { cgstRate: decimal(0), sgstRate: decimal(0), utgstRate: decimal(0), igstRate: rate,
      cgst: decimal(0), sgst: decimal(0), utgst: decimal(0), igst: cents(taxable.mul(rate).div(100)) };
  }
  const halfRate = rate.div(2);
  const combinedTax = cents(taxable.mul(rate).div(100));
  const firstComponent = combinedTax.div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const secondComponent = combinedTax.minus(firstComponent);
  return {
    cgstRate: halfRate,
    sgstRate: unionTerritory ? decimal(0) : halfRate,
    utgstRate: unionTerritory ? halfRate : decimal(0),
    igstRate: decimal(0),
    cgst: firstComponent,
    sgst: unionTerritory ? decimal(0) : secondComponent,
    utgst: unionTerritory ? secondComponent : decimal(0),
    igst: decimal(0),
  };
}

function isUnionTerritory(code: string | null) {
  return ["04", "26", "31", "34", "35", "38"].includes(code ?? "");
}

export function calculateGstAmounts(
  taxableAmount: string,
  gstRate: string,
  companyStateCode: string | null,
  partyStateCode: string | null,
) {
  const tax = taxesForLine(
    decimal(taxableAmount),
    decimal(gstRate),
    Boolean(companyStateCode && companyStateCode === partyStateCode),
    isUnionTerritory(companyStateCode),
  );
  return {
    cgst: tax.cgst.toFixed(2),
    sgst: tax.sgst.toFixed(2),
    utgst: tax.utgst.toFixed(2),
    igst: tax.igst.toFixed(2),
  };
}

async function resolveLines(
  tx: Prisma.TransactionClient,
  companyId: string,
  party: { stateCode: string | null },
  company: { stateCode: string | null },
  lines: SalesLine[],
) {
  const result = [];
  const intraState = Boolean(company.stateCode && company.stateCode === party.stateCode);
  const ut = isUnionTerritory(company.stateCode);
  for (const [index, line] of lines.entries()) {
    let item: {
      id: string; name: string; hsnSac: string | null; gstRate: Prisma.Decimal;
      salesRate: Prisma.Decimal; baseUnit: { symbol: string }; batchTracked: boolean;
    } | null = null;
    if (line.itemId) {
      item = await tx.stockItem.findFirst({
        where: { companyId, id: line.itemId, isActive: true },
        select: { id: true, name: true, hsnSac: true, gstRate: true, salesRate: true, batchTracked: true, baseUnit: { select: { symbol: true } } },
      });
      if (!item) throw new NotFoundError("A sales item was not found in the active company");
      if (line.unit !== item.baseUnit.symbol) throw new ValidationError(`Sales unit must be the item's base unit (${item.baseUnit.symbol})`);
    }
    const quantity = decimal(line.quantity);
    const rate = decimal(line.unitRate);
    const gross = cents(quantity.mul(rate));
    const discountPercent = decimal(line.discountPercent ?? "0");
    const discountAmount = cents(gross.mul(discountPercent).div(100));
    const taxable = gross.minus(discountAmount);
    if (taxable.lessThanOrEqualTo(0)) throw new ValidationError("Each sales line must have a positive taxable amount");
    const gstRate = line.gstRate !== undefined ? decimal(line.gstRate) : item?.gstRate ?? decimal(0);
    const tax = taxesForLine(taxable, gstRate, intraState, ut);
    if (item?.batchTracked && !line.batchNumber) {
      throw new ValidationError(`A batch number is required for ${item.name}`);
    }
    if (item && line.warehouseId) {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: line.warehouseId, companyId, isActive: true },
        select: { id: true },
      });
      if (!warehouse) throw new NotFoundError("An active warehouse was not found in the current company");
    }
    result.push({
      lineNumber: index + 1,
      itemId: item?.id ?? null,
      description: line.description.trim(),
      hsnSac: item?.hsnSac ?? null,
      unit: line.unit,
      quantity,
      unitRate: rate,
      discountPercent,
      discountAmount,
      taxableAmount: taxable,
      gstRate,
      cgstRate: tax.cgstRate,
      sgstRate: tax.sgstRate,
      utgstRate: tax.utgstRate,
      igstRate: tax.igstRate,
      cgstAmount: tax.cgst,
      sgstAmount: tax.sgst,
      utgstAmount: tax.utgst,
      igstAmount: tax.igst,
      warehouseId: line.warehouseId ?? null,
      batchNumber: line.batchNumber || null,
      manufacturingDate: line.manufacturingDate ? date(line.manufacturingDate) : null,
      expiryDate: line.expiryDate ? date(line.expiryDate) : null,
      sourceLineId: line.sourceLineId ?? null,
    });
  }
  return result;
}

async function appendEvent(
  tx: Prisma.TransactionClient,
  actor: Actor,
  documentId: string,
  eventType: "CREATED" | "ISSUED" | "ACCEPTED" | "REJECTED" | "ORDER_CREATED" | "DELIVERY_POSTED" | "INVOICE_POSTED" | "CANCELLED" | "REVERSED" | "EMAIL_SENT" | "WHATSAPP_SENT",
  idempotencyKey: string,
  snapshot: Prisma.InputJsonValue,
) {
  await tx.salesDocumentEvent.create({
    data: { companyId: actor.companyId, documentId, actorId: actor.userId, eventType, idempotencyKey, snapshot },
  });
}

async function refreshInvoiceProgress(
  tx: Prisma.TransactionClient,
  companyId: string,
  sourceDocumentId: string,
) {
  const source = await tx.salesDocument.findFirst({
    where: { id: sourceDocumentId, companyId },
    include: { lines: { select: { quantity: true, deliveredQuantity: true, invoicedQuantity: true } } },
  });
  if (!source || !["SALES_ORDER", "DELIVERY_NOTE"].includes(source.documentType)) return;
  const invoicedSome = source.lines.some((line) => line.invoicedQuantity.greaterThan(0));
  const invoicedAll = source.lines.length > 0 &&
    source.lines.every((line) => line.invoicedQuantity.greaterThanOrEqualTo(line.quantity));
  const deliveredSome = source.lines.some((line) => line.deliveredQuantity.greaterThan(0));
  const deliveredAll = source.lines.length > 0 &&
    source.lines.every((line) => line.deliveredQuantity.greaterThanOrEqualTo(line.quantity));
  const status = invoicedAll ? "INVOICED"
    : invoicedSome ? "PARTIALLY_INVOICED"
      : source.documentType === "SALES_ORDER" && deliveredAll ? "DELIVERED"
        : source.documentType === "SALES_ORDER" && deliveredSome ? "PARTIALLY_DELIVERED"
          : source.documentType === "SALES_ORDER" ? "ACCEPTED" : "POSTED";
  await tx.salesDocument.update({ where: { id: source.id }, data: { status } });
  if (source.documentType === "DELIVERY_NOTE" && source.sourceDocumentId) {
    await refreshInvoiceProgress(tx, companyId, source.sourceDocumentId);
  }
}

async function assertNoActiveDescendants(
  tx: Prisma.TransactionClient,
  companyId: string,
  documentId: string,
) {
  let parentIds = [documentId];
  while (parentIds.length) {
    const children = await tx.salesDocument.findMany({
      where: { companyId, sourceDocumentId: { in: parentIds } },
      select: { id: true, status: true },
    });
    if (children.some((child) => !["CANCELLED", "REVERSED"].includes(child.status))) {
      throw new ConflictError("Cancel or reverse downstream sales documents before cancelling this source");
    }
    parentIds = children.map((child) => child.id);
  }
}

export async function createSalesDraft(
  actor: Actor,
  input: CreateInput,
  rawKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const bodyHash = digest(input);
  return withTransaction(async (tx) => {
    const prior = await tx.salesDocument.findUnique({
      where: { companyId_idempotencyKey: { companyId: actor.companyId, idempotencyKey: key } },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (prior) {
      if (prior.requestHash !== bodyHash) throw new ConflictError("Idempotency-Key was used for different sales details");
      return { document: prior, replayed: true };
    }
    const [party, company] = await Promise.all([
      tx.party.findFirst({ where: { id: input.partyId, companyId: actor.companyId, type: "CUSTOMER", isActive: true } }),
      tx.company.findUniqueOrThrow({ where: { id: actor.companyId } }),
    ]);
    if (!party) throw new NotFoundError("Active customer not found in the current company");
    const documentDate = date(input.documentDate);
    await validateSalesDate(tx, actor.companyId, documentDate);
    const lines = await resolveLines(tx, actor.companyId, party, company, input.lines);
    const subtotal = lines.reduce((sum, line) => sum.plus(line.quantity.mul(line.unitRate)), decimal(0));
    const discountAmount = lines.reduce((sum, line) => sum.plus(line.discountAmount), decimal(0));
    const taxableAmount = lines.reduce((sum, line) => sum.plus(line.taxableAmount), decimal(0));
    const cgst = lines.reduce((sum, line) => sum.plus(line.cgstAmount), decimal(0));
    const sgst = lines.reduce((sum, line) => sum.plus(line.sgstAmount), decimal(0));
    const utgst = lines.reduce((sum, line) => sum.plus(line.utgstAmount), decimal(0));
    const igst = lines.reduce((sum, line) => sum.plus(line.igstAmount), decimal(0));
    const freight = decimal(input.freight);
    const otherCharges = decimal(input.otherCharges);
    const roundOff = decimal(input.roundOff);
    const totalAmount = cents(taxableAmount.plus(cgst).plus(sgst).plus(utgst).plus(igst).plus(freight).plus(otherCharges).plus(roundOff));
    if (totalAmount.lessThan(0)) throw new ValidationError("Sales document total cannot be negative");
    const { seriesId, number } = await nextNumber(tx, actor.companyId, input.documentType, documentDate);
    const billingAddress = input.billingAddress ?? {
      addressLine1: party.addressLine1 ?? "", addressLine2: party.addressLine2 ?? "",
      city: party.city ?? "", state: party.state ?? "", stateCode: party.stateCode ?? "",
      postalCode: party.postalCode ?? "", country: party.country,
    };
    const shippingAddress = input.shippingAddress ?? billingAddress;
    const document = await tx.salesDocument.create({
      data: {
        companyId: actor.companyId,
        documentNumber: number,
        documentType: input.documentType,
        status: "DRAFT",
        partyId: party.id,
        numberSeriesId: seriesId,
        documentDate,
        validUntil: input.validUntil ? date(input.validUntil) : null,
        billingAddress: inputJson(billingAddress),
        shippingAddress: inputJson(shippingAddress),
        companySnapshot: inputJson({
          name: company.name, legalName: company.legalName, gstin: company.gstin,
          pan: company.pan, addressLine1: company.addressLine1, addressLine2: company.addressLine2,
          city: company.city, state: company.state, stateCode: company.stateCode,
          postalCode: company.postalCode, email: company.email, phone: company.phone,
        }),
        partySnapshot: inputJson({
          name: party.name, gstin: party.gstin, pan: party.pan, email: party.email,
          phone: party.phone, state: party.state, stateCode: party.stateCode,
        }),
        notes: input.notes || null,
        subtotal: cents(subtotal),
        discountAmount: cents(discountAmount),
        freight,
        otherCharges,
        taxableAmount: cents(taxableAmount),
        cgstAmount: cents(cgst),
        sgstAmount: cents(sgst),
        utgstAmount: cents(utgst),
        igstAmount: cents(igst),
        roundOff,
        totalAmount,
        idempotencyKey: key,
        requestHash: bodyHash,
        createdById: actor.userId,
        lines: { create: lines },
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    await appendEvent(tx, actor, document.id, "CREATED", `${key}:created`, inputJson({ documentNumber: number, documentType: input.documentType }));
    await writeAuditLog({
      companyId: actor.companyId,
      actorId: actor.userId,
      action: "SALES_DOCUMENT_CREATED",
      entityType: "SalesDocument",
      entityId: document.id,
      changes: inputJson({ documentNumber: number, documentType: input.documentType, totalAmount: totalAmount.toString() }),
      ...requestInfo,
    }, tx);
    return { document, replayed: false };
  });
}

export async function transitionSalesDocument(
  actor: Actor,
  documentId: string,
  action: "ISSUE" | "ACCEPT" | "REJECT",
  rawKey: string | null,
  reason: string | undefined,
  requestInfo: RequestInfo,
) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  return withTransaction(async (tx) => {
    const doc = await tx.salesDocument.findFirst({
      where: { companyId: actor.companyId, id: documentId },
      include: { lines: true },
    });
    if (!doc) throw new NotFoundError("Sales document not found in the current company");
    if (doc.status === (action === "ISSUE" ? "ISSUED" : action === "ACCEPT" ? "ACCEPTED" : "REJECTED")) {
      return { document: doc, replayed: true };
    }
    if (action === "ISSUE" && doc.status !== "DRAFT") throw new ConflictError("Only draft quotations and orders can be issued");
    if (action !== "ISSUE" && doc.documentType !== "QUOTATION") throw new ValidationError("Only quotations can be accepted or rejected");
    if (action !== "ISSUE" && doc.status !== "ISSUED") throw new ConflictError("Only issued quotations can be accepted or rejected");
    const status = action === "ISSUE" ? "ISSUED" : action === "ACCEPT" ? "ACCEPTED" : "REJECTED";
    const document = await tx.salesDocument.update({
      where: { id: doc.id },
      data: {
        status,
        ...(action === "ISSUE" ? { issuedById: actor.userId, issuedAt: new Date() } : {}),
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    await appendEvent(tx, actor, doc.id, status === "ISSUED" ? "ISSUED" : status, key, inputJson({ previousStatus: doc.status, status, reason: reason ?? "" }));
    await writeAuditLog({
      companyId: actor.companyId, actorId: actor.userId, action: `SALES_DOCUMENT_${status}`,
      entityType: "SalesDocument", entityId: doc.id, changes: inputJson({ previousStatus: doc.status, status, reason: reason ?? "" }),
      ...requestInfo,
    }, tx);
    return { document, replayed: false };
  });
}

export async function convertSalesDocument(
  actor: Actor,
  sourceDocumentId: string,
  input: ConvertInput,
  rawKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const bodyHash = digest({ sourceDocumentId, input });
  return withTransaction(async (tx) => {
    const prior = await tx.salesDocument.findUnique({
      where: { companyId_idempotencyKey: { companyId: actor.companyId, idempotencyKey: key } },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (prior) {
      if (prior.requestHash !== bodyHash) throw new ConflictError("Idempotency-Key was used for different conversion details");
      return { document: prior, replayed: true };
    }
    const source = await tx.salesDocument.findFirst({
      where: { id: sourceDocumentId, companyId: actor.companyId },
      include: { party: true, lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!source) throw new NotFoundError("Source sales document not found in the current company");
    const accepted = source.documentType === "QUOTATION"
      ? source.status === "ACCEPTED"
      : ["ISSUED", "ACCEPTED", "PARTIALLY_DELIVERED", "DELIVERED", "PARTIALLY_INVOICED"].includes(source.status);
    const sourceReady = accepted ||
      (source.documentType === "DELIVERY_NOTE" && ["POSTED", "PARTIALLY_INVOICED"].includes(source.status));
    if (!sourceReady) throw new ConflictError("The source document must be issued, accepted or posted before conversion");
    const targetType = input.documentType;
    if (source.documentType === "QUOTATION" && targetType !== "SALES_ORDER") throw new ValidationError("A quotation must first be converted to a sales order");
    if (source.documentType === "SALES_ORDER" && !["DELIVERY_NOTE", "SALES_INVOICE"].includes(targetType)) {
      throw new ValidationError("A sales order can only be converted to a delivery note or sales invoice");
    }
    if (source.documentType === "DELIVERY_NOTE" && targetType !== "SALES_INVOICE") {
      throw new ValidationError("A delivery note can only be converted to a sales invoice");
    }
    const sourceLines = new Map(source.lines.map((line) => [line.id, line]));
    const selectedLines = [];
    for (const requested of input.lines) {
      const sourceLine = sourceLines.get(requested.sourceLineId);
      if (!sourceLine) throw new NotFoundError("A source line does not belong to the selected document");
      const alreadyFulfilled = targetType === "DELIVERY_NOTE" ? sourceLine.deliveredQuantity : sourceLine.invoicedQuantity;
      if (decimal(requested.quantity).plus(alreadyFulfilled).greaterThan(sourceLine.quantity)) {
        throw new ConflictError(`Requested quantity exceeds the unfulfilled quantity of ${sourceLine.description}`);
      }
      selectedLines.push({
        itemId: sourceLine.itemId ?? undefined,
        sourceLineId: sourceLine.id,
        description: sourceLine.description,
        unit: sourceLine.unit,
        quantity: requested.quantity,
        unitRate: sourceLine.unitRate.toString(),
        discountPercent: sourceLine.discountPercent.toString(),
        gstRate: sourceLine.gstRate.toString(),
        warehouseId: requested.warehouseId,
        batchNumber: requested.batchNumber,
      });
    }
    const company = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId } });
    await validateSalesDate(tx, actor.companyId, date(input.documentDate));
    const lines = await resolveLines(tx, actor.companyId, source.party, company, selectedLines);
    const subtotal = lines.reduce((sum, line) => sum.plus(line.quantity.mul(line.unitRate)), decimal(0));
    const discountAmount = lines.reduce((sum, line) => sum.plus(line.discountAmount), decimal(0));
    const taxableAmount = lines.reduce((sum, line) => sum.plus(line.taxableAmount), decimal(0));
    const cgst = lines.reduce((sum, line) => sum.plus(line.cgstAmount), decimal(0));
    const sgst = lines.reduce((sum, line) => sum.plus(line.sgstAmount), decimal(0));
    const utgst = lines.reduce((sum, line) => sum.plus(line.utgstAmount), decimal(0));
    const igst = lines.reduce((sum, line) => sum.plus(line.igstAmount), decimal(0));
    const { seriesId, number } = await nextNumber(tx, actor.companyId, targetType, date(input.documentDate));
    const dueDate = input.dueDate
      ? date(input.dueDate)
      : targetType === "SALES_INVOICE" && input.paymentMode === "CREDIT"
        ? new Date(date(input.documentDate).getTime() + source.party.creditPeriodDays * 86_400_000)
        : null;
    const document = await tx.salesDocument.create({
      data: {
        companyId: actor.companyId, documentNumber: number, documentType: targetType,
        status: "DRAFT", partyId: source.partyId, sourceDocumentId: source.id, numberSeriesId: seriesId,
        documentDate: date(input.documentDate), dueDate,
        validUntil: input.validUntil ? date(input.validUntil) : null,
        paymentMode: targetType === "SALES_INVOICE" ? input.paymentMode ?? null : null,
        paymentLedgerId: targetType === "SALES_INVOICE" ? input.paymentLedgerId ?? null : null,
        invoiceNature: targetType === "SALES_INVOICE" ? lines.every((line) => !line.itemId) ? "SERVICE" : "GOODS" : null,
        billingAddress: JSON.parse(JSON.stringify(source.billingAddress)) as Prisma.InputJsonValue,
        shippingAddress: JSON.parse(JSON.stringify(source.shippingAddress)) as Prisma.InputJsonValue,
        companySnapshot: JSON.parse(JSON.stringify(source.companySnapshot)) as Prisma.InputJsonValue,
        partySnapshot: JSON.parse(JSON.stringify(source.partySnapshot)) as Prisma.InputJsonValue,
        notes: source.notes,
        subtotal: cents(subtotal), discountAmount: cents(discountAmount), freight: decimal(0), otherCharges: decimal(0),
        taxableAmount: cents(taxableAmount), cgstAmount: cents(cgst), sgstAmount: cents(sgst),
        utgstAmount: cents(utgst), igstAmount: cents(igst), roundOff: decimal(0),
        totalAmount: cents(taxableAmount.plus(cgst).plus(sgst).plus(utgst).plus(igst)),
        idempotencyKey: key, requestHash: bodyHash, createdById: actor.userId,
        lines: { create: lines },
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    const updatedSourceStatus = targetType === "SALES_ORDER"
      ? source.status
      : targetType === "DELIVERY_NOTE" ? "PARTIALLY_DELIVERED" : "PARTIALLY_INVOICED";
    await tx.salesDocument.update({ where: { id: source.id }, data: { status: updatedSourceStatus } });
    await appendEvent(tx, actor, document.id, targetType === "SALES_ORDER" ? "ORDER_CREATED" : "CREATED", `${key}:created`, inputJson({ sourceDocumentId: source.id, documentNumber: number }));
    await writeAuditLog({
      companyId: actor.companyId, actorId: actor.userId, action: `SALES_${targetType}_CREATED`,
      entityType: "SalesDocument", entityId: document.id,
      changes: inputJson({ sourceDocumentId: source.id, documentNumber: number }), ...requestInfo,
    }, tx);
    return { document, replayed: false };
  });
}

async function ensureSalesAccounts(tx: Prisma.TransactionClient, companyId: string) {
  const chart = await ensureDefaultChart(tx, companyId);
  const accounts = [
    { code: "SALES_REVENUE", name: "Sales Revenue", groupId: chart.groups.get("DIRECT_INCOME")!, type: "INCOME" as const },
    { code: "ROUND_OFF_INCOME", name: "Round Off Gain", groupId: chart.groups.get("INDIRECT_INCOME")!, type: "INCOME" as const },
    { code: "ROUND_OFF_EXPENSE", name: "Round Off Loss", groupId: chart.groups.get("INDIRECT_EXPENSES")!, type: "EXPENSE" as const },
    { code: "COST_OF_GOODS_SOLD", name: "Cost of Goods Sold", groupId: chart.groups.get("DIRECT_EXPENSES")!, type: "EXPENSE" as const },
    { code: "OUTPUT_CGST", name: "Output CGST", groupId: chart.groups.get("DUTIES_TAXES")!, type: "TAX" as const },
    { code: "OUTPUT_SGST", name: "Output SGST", groupId: chart.groups.get("DUTIES_TAXES")!, type: "TAX" as const },
    { code: "OUTPUT_UTGST", name: "Output UTGST", groupId: chart.groups.get("DUTIES_TAXES")!, type: "TAX" as const },
    { code: "OUTPUT_IGST", name: "Output IGST", groupId: chart.groups.get("DUTIES_TAXES")!, type: "TAX" as const },
  ];
  const ids = new Map<string, string>();
  for (const account of accounts) {
    const ledger = await tx.ledger.upsert({
      where: { companyId_code: { companyId, code: account.code } },
      create: {
        companyId, name: account.name, code: account.code, groupId: account.groupId,
        type: account.type, isSystem: true, creationKey: `system:${account.code.toLowerCase()}`, creationHash: "system",
      },
      update: {},
      select: { id: true },
    });
    ids.set(account.code, ledger.id);
  }
  return { ...chart, accounts: ids };
}

export async function postSalesInvoice(
  actor: Actor,
  documentId: string,
  rawKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const requestHash = digest({ documentId, action: "post" });
  return withTransaction(async (tx) => {
    const prior = await tx.salesDocument.findUnique({
      where: { companyId_postIdempotencyKey: { companyId: actor.companyId, postIdempotencyKey: key } },
      include: { lines: true },
    });
    if (prior) {
      if (prior.postRequestHash !== requestHash) throw new ConflictError("Idempotency-Key was used for a different sales posting");
      return { document: prior, replayed: true };
    }
    const document = await tx.salesDocument.findFirst({
      where: { id: documentId, companyId: actor.companyId, documentType: "SALES_INVOICE", status: "DRAFT" },
      include: {
        party: true,
        sourceDocument: { select: { id: true, documentType: true, status: true } },
        lines: { orderBy: { lineNumber: "asc" }, include: { sourceLine: { select: { id: true, sourceLineId: true, unitCost: true } } } },
      },
    });
    if (!document) throw new NotFoundError("Draft sales invoice not found in the current company");
    if (document.sourceDocument) {
      const sourceStatus = document.sourceDocument.status;
      if (["CANCELLED", "REVERSED", "REJECTED", "DRAFT"].includes(sourceStatus) ||
        (document.sourceDocument.documentType === "DELIVERY_NOTE" &&
          !["POSTED", "PARTIALLY_INVOICED"].includes(sourceStatus))) {
        throw new ConflictError("The source sales document is no longer available for invoicing");
      }
      if (!["SALES_ORDER", "DELIVERY_NOTE"].includes(document.sourceDocument.documentType)) {
        throw new ValidationError("Sales invoices must come from an order, delivery note, or standalone draft");
      }
    }
    if (!document.paymentMode) throw new ValidationError("Select cash or credit payment before posting the invoice");
    if (document.totalAmount.lessThanOrEqualTo(0)) throw new ValidationError("A sales invoice total must be greater than zero");
    for (const line of document.lines) {
      if (!line.sourceLineId) continue;
      const sourceLine = await tx.salesDocumentLine.findFirst({
        where: { id: line.sourceLineId, companyId: actor.companyId },
        select: { quantity: true, invoicedQuantity: true, sourceLineId: true },
      });
      if (!sourceLine) throw new NotFoundError("Invoice line source is not in the current company");
      if (sourceLine.invoicedQuantity.plus(line.quantity).greaterThan(sourceLine.quantity)) {
        throw new ConflictError(`Posting this invoice would exceed the source quantity for ${line.description}`);
      }
      if (document.sourceDocument?.documentType === "DELIVERY_NOTE" && sourceLine.sourceLineId) {
        const orderLine = await tx.salesDocumentLine.findFirst({
          where: { id: sourceLine.sourceLineId, companyId: actor.companyId },
          select: { quantity: true, invoicedQuantity: true },
        });
        if (!orderLine || orderLine.invoicedQuantity.plus(line.quantity).greaterThan(orderLine.quantity)) {
          throw new ConflictError(`Posting this invoice would exceed the ordered quantity for ${line.description}`);
        }
      }
    }
    const accounts = await ensureSalesAccounts(tx, actor.companyId);
    if (document.paymentMode === "CASH" && !document.paymentLedgerId) {
      throw new ValidationError("Choose an active cash or bank ledger for this company");
    }
    const receivableLedger = document.paymentMode === "CASH"
      ? await tx.ledger.findFirst({
          where: { id: document.paymentLedgerId ?? "", companyId: actor.companyId, isActive: true, type: { in: ["CASH", "BANK"] } },
          select: { id: true },
        })
      : await tx.ledger.findFirst({
          where: { companyId: actor.companyId, partyId: document.partyId, isActive: true },
          select: { id: true },
        });
    if (!receivableLedger) throw new ValidationError(document.paymentMode === "CASH"
      ? "Choose an active cash or bank ledger for this company"
      : "The customer does not have an active linked receivable ledger");

    const debitLines: { ledgerId: string; description: string; debit: string; credit: string }[] = [];
    const creditLines: { ledgerId: string; description: string; debit: string; credit: string }[] = [];
    const total = document.totalAmount;
    if (document.paymentMode === "CREDIT") {
      const outstanding = await tx.ledgerTransaction.aggregate({
        where: {
          companyId: actor.companyId,
          ledgerId: receivableLedger.id,
          voucher: { status: { in: ["POSTED", "REVERSED"] } },
        },
        _sum: { debit: true, credit: true },
      });
      const openAmount = Prisma.Decimal.max(
        decimal(0),
        (outstanding._sum.debit ?? decimal(0)).minus(outstanding._sum.credit ?? decimal(0)),
      );
      if (document.party.creditLimit.greaterThan(0) && openAmount.plus(total).greaterThan(document.party.creditLimit)) {
        throw new ConflictError("Posting this invoice would exceed the customer's credit limit");
      }
    }
    debitLines.push({
      ledgerId: receivableLedger.id,
      description: `${document.paymentMode === "CASH" ? "Cash sale" : "Receivable"} · ${document.documentNumber}`,
      debit: total.toString(), credit: "0",
    });
    for (const line of document.lines) {
      creditLines.push({
        ledgerId: accounts.accounts.get("SALES_REVENUE")!,
        description: `Sales revenue · ${document.documentNumber} · ${line.lineNumber}`,
        debit: "0",
        credit: line.taxableAmount.toString(),
      });
    }
    if (document.freight.plus(document.otherCharges).greaterThan(0)) {
      creditLines.push({
        ledgerId: accounts.accounts.get("SALES_REVENUE")!,
        description: `Sales charges · ${document.documentNumber}`,
        debit: "0",
        credit: document.freight.plus(document.otherCharges).toString(),
      });
    }
    if (document.roundOff.greaterThan(0)) {
      creditLines.push({
        ledgerId: accounts.accounts.get("ROUND_OFF_INCOME")!,
        description: `Round-off gain · ${document.documentNumber}`,
        debit: "0",
        credit: document.roundOff.toString(),
      });
    } else if (document.roundOff.lessThan(0)) {
      debitLines.push({
        ledgerId: accounts.accounts.get("ROUND_OFF_EXPENSE")!,
        description: `Round-off loss · ${document.documentNumber}`,
        debit: document.roundOff.abs().toString(),
        credit: "0",
      });
    }
    const taxTypes = [
      ["CGST", "OUTPUT_CGST", document.cgstAmount],
      ["SGST", "OUTPUT_SGST", document.sgstAmount],
      ["UTGST", "OUTPUT_UTGST", document.utgstAmount],
      ["IGST", "OUTPUT_IGST", document.igstAmount],
    ] as const;
    for (const [taxType, code, taxAmount] of taxTypes) {
      if (taxAmount.isZero()) continue;
      creditLines.push({
        ledgerId: accounts.accounts.get(code)!,
        description: `Output ${taxType} · ${document.documentNumber}`,
        debit: "0", credit: taxAmount.toString(),
      });
    }

    const stockLines: { source: typeof document.lines[number]; unitCost: Prisma.Decimal; quantity: Prisma.Decimal }[] = [];
    let cogs = decimal(0);
    for (const line of document.lines) {
      if (!line.itemId) continue;
      if (!line.warehouseId) throw new ValidationError(`Select a godown for ${line.description}`);
      let quantityToIssue = line.quantity;
      if (document.sourceDocument?.documentType === "DELIVERY_NOTE") {
        if (!line.sourceLine?.unitCost) throw new ConflictError(`The posted delivery has no inventory cost for ${line.description}`);
        cogs = cogs.plus(cents(line.quantity.mul(line.sourceLine.unitCost)));
        quantityToIssue = decimal(0);
      } else if (document.sourceDocument?.documentType === "SALES_ORDER" && line.sourceLineId) {
        const deliveries = await tx.salesDocumentLine.findMany({
          where: {
            companyId: actor.companyId,
            sourceLineId: line.sourceLineId,
            document: { documentType: "DELIVERY_NOTE", status: "POSTED" },
          },
          select: { quantity: true, unitCost: true },
        });
        let deliveredForInvoice = decimal(0);
        let historicalCost = decimal(0);
        for (const delivery of deliveries) {
          const coveredQuantity = Prisma.Decimal.min(
            delivery.quantity,
            Prisma.Decimal.max(decimal(0), line.quantity.minus(deliveredForInvoice)),
          );
          if (coveredQuantity.isZero()) continue;
          if (!delivery.unitCost) throw new ConflictError(`A posted delivery has no inventory cost for ${line.description}`);
          historicalCost = historicalCost.plus(coveredQuantity.mul(delivery.unitCost));
          deliveredForInvoice = deliveredForInvoice.plus(coveredQuantity);
        }
        cogs = cogs.plus(cents(historicalCost));
        const delivered = deliveries.reduce((sum, entry) => sum.plus(entry.quantity), decimal(0));
        quantityToIssue = Prisma.Decimal.max(decimal(0), line.quantity.minus(delivered));
      }
      if (quantityToIssue.isZero()) continue;
      const batch = line.batchNumber
        ? await tx.inventoryBatch.findUnique({
            where: {
              companyId_itemId_warehouseId_batchNumber: {
                companyId: actor.companyId, itemId: line.itemId, warehouseId: line.warehouseId, batchNumber: line.batchNumber,
              },
            },
            select: { id: true },
          })
        : null;
      const balance = await tx.stockBalance.findFirst({
        where: {
          companyId: actor.companyId, itemId: line.itemId, warehouseId: line.warehouseId,
          locationKey: batch?.id ?? "NO_BATCH",
        },
        select: { quantity: true, value: true },
      });
      if (!balance || balance.quantity.lessThan(quantityToIssue) || balance.quantity.isZero()) {
        throw new ConflictError(`Insufficient stock for ${line.description} in the selected godown or batch`);
      }
      const unitCost = balance.value.div(balance.quantity).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const lineCost = cents(quantityToIssue.mul(unitCost));
      cogs = cogs.plus(lineCost);
      stockLines.push({ source: line, unitCost, quantity: quantityToIssue });
    }
    if (cogs.greaterThan(0)) {
      for (const { source, unitCost, quantity } of stockLines) {
        const lineCost = cents(quantity.mul(unitCost));
        debitLines.push({
          ledgerId: accounts.accounts.get("COST_OF_GOODS_SOLD")!,
          description: `COGS · ${source.description} · ${document.documentNumber} · ${source.lineNumber}`,
          debit: lineCost.toString(), credit: "0",
        });
        creditLines.push({
          ledgerId: accounts.inventoryLedgerId,
          description: `Stock · ${source.description} · ${document.documentNumber} · ${source.lineNumber}`,
          debit: "0", credit: lineCost.toString(),
        });
      }
    }
    const postingKey = hashIdempotencyKey(`${rawKey}:voucher`);
    const voucher = await createPostedVoucherWithinTransaction(tx, actor, {
      type: "SALES",
      voucherDate: document.documentDate.toISOString().slice(0, 10),
      narration: `Sales invoice ${document.documentNumber}`,
      idempotencyKey: postingKey,
      requestHash,
      lines: [...debitLines, ...creditLines],
      requestInfo,
    });
    const voucherLines = await tx.voucherLine.findMany({
      where: { companyId: actor.companyId, voucherId: voucher.id },
      orderBy: { lineNumber: "asc" },
      select: { id: true, ledgerId: true, description: true },
    });
    const taxDetailRows = [];
    for (const line of document.lines) {
      const revenueLine = voucherLines.find((entry) =>
        entry.ledgerId === accounts.accounts.get("SALES_REVENUE") &&
        entry.description === `Sales revenue · ${document.documentNumber} · ${line.lineNumber}`,
      );
      if (!revenueLine) throw new Error(`Posted sales voucher is missing revenue line ${line.lineNumber}`);
      const components = [
        ["CGST", line.cgstAmount, line.cgstRate, accounts.accounts.get("OUTPUT_CGST")!],
        ["SGST", line.sgstAmount, line.sgstRate, accounts.accounts.get("OUTPUT_SGST")!],
        ["UTGST", line.utgstAmount, line.utgstRate, accounts.accounts.get("OUTPUT_UTGST")!],
        ["IGST", line.igstAmount, line.igstRate, accounts.accounts.get("OUTPUT_IGST")!],
      ] as const;
      for (const [type, taxAmount, rate, taxLedgerId] of components) {
        if (taxAmount.isZero()) continue;
        taxDetailRows.push({
          companyId: actor.companyId, voucherLineId: revenueLine.id, taxLedgerId,
          taxType: type, taxableAmount: line.taxableAmount, taxAmount, rate,
        });
      }
    }
    if (taxDetailRows.length) await tx.voucherTaxDetail.createMany({ data: taxDetailRows });
    const taxTransactions = taxDetailRows.map((tax) => ({
      companyId: actor.companyId, voucherId: voucher.id, voucherLineId: tax.voucherLineId,
      ledgerId: tax.taxLedgerId, taxType: tax.taxType, taxableAmount: tax.taxableAmount,
      taxAmount: tax.taxAmount, rate: tax.rate, transactionDate: document.documentDate,
    }));
    if (taxTransactions.length) await tx.taxTransaction.createMany({ data: taxTransactions });
    const receivableLine = voucherLines.find((line) => line.ledgerId === receivableLedger.id);
    if (document.paymentMode === "CREDIT" && receivableLine) {
      await tx.billWiseEntry.create({
        data: {
          companyId: actor.companyId, voucherId: voucher.id, voucherLineId: receivableLine.id,
          referenceType: "NEW", referenceNumber: document.documentNumber,
          dueDate: document.dueDate, amount: total,
          settledAmount: decimal(0), remainingAmount: total,
        },
      });
    }
    for (const { source, unitCost, quantity } of stockLines) {
      const stockCreditLine = voucherLines.find((line) =>
        line.ledgerId === accounts.inventoryLedgerId && line.description === `Stock · ${source.description} · ${document.documentNumber} · ${source.lineNumber}`,
      );
      if (stockCreditLine) {
        await tx.voucherStockDetail.create({
          data: {
            companyId: actor.companyId, voucherLineId: stockCreditLine.id,
            itemId: source.itemId!, warehouseId: source.warehouseId!, batchNumber: source.batchNumber,
            manufacturingDate: source.manufacturingDate, expiryDate: source.expiryDate,
            movementType: "SALES", direction: "OUT", quantity, unitCost,
          },
        });
      }
      await postInventoryMovement(tx, actor, {
        itemId: source.itemId!,
        input: {
          warehouseId: source.warehouseId!,
          quantity: quantity.toString(),
          unitCost: unitCost.toString(),
          batchNumber: source.batchNumber ?? "",
          manufacturingDate: source.manufacturingDate?.toISOString().slice(0, 10) ?? "",
          expiryDate: source.expiryDate?.toISOString().slice(0, 10) ?? "",
        },
        date: document.documentDate.toISOString().slice(0, 10),
        type: "SALES",
        direction: "OUT",
        idempotencyKey: `${rawKey}:stock:${source.id}`,
        voucherId: voucher.id,
        requestInfo,
      });
    }
    for (const line of document.lines) {
      if (line.sourceLineId) {
        const sourceLine = await tx.salesDocumentLine.findFirst({
          where: { id: line.sourceLineId, companyId: actor.companyId },
          select: { sourceLineId: true },
        });
        await tx.salesDocumentLine.update({
          where: { id: line.sourceLineId },
          data: { invoicedQuantity: { increment: line.quantity } },
        });
        if (document.sourceDocument?.documentType === "DELIVERY_NOTE" && sourceLine?.sourceLineId) {
          await tx.salesDocumentLine.update({
            where: { id: sourceLine.sourceLineId },
            data: { invoicedQuantity: { increment: line.quantity } },
          });
        }
      }
    }
    if (document.sourceDocumentId) {
      await refreshInvoiceProgress(tx, actor.companyId, document.sourceDocumentId);
    }
    const posted = await tx.salesDocument.update({
      where: { id: document.id },
      data: {
        status: "POSTED", voucherId: voucher.id, paymentMode: document.paymentMode,
        paymentLedgerId: document.paymentLedgerId, postedAt: new Date(),
        postIdempotencyKey: key, postRequestHash: requestHash, costOfGoodsSold: cents(cogs),
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    await appendEvent(tx, actor, document.id, "INVOICE_POSTED", `${key}:posted`, inputJson({ voucherId: voucher.id, voucherNumber: voucher.voucherNumber, total: total.toString() }));
    await writeAuditLog({
      companyId: actor.companyId, actorId: actor.userId, action: "SALES_INVOICE_POSTED",
      entityType: "SalesDocument", entityId: document.id,
      changes: inputJson({ voucherId: voucher.id, voucherNumber: voucher.voucherNumber, total: total.toString(), cogs: cents(cogs).toString() }),
      ...requestInfo,
    }, tx);
    return { document: posted, voucher, replayed: false };
  });
}

export async function postSalesDelivery(
  actor: Actor,
  documentId: string,
  rawKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const requestHash = digest({ documentId, action: "post-delivery" });
  return withTransaction(async (tx) => {
    const prior = await tx.salesDocument.findUnique({
      where: { companyId_postIdempotencyKey: { companyId: actor.companyId, postIdempotencyKey: key } },
      include: { lines: true },
    });
    if (prior) {
      if (prior.postRequestHash !== requestHash) throw new ConflictError("Idempotency-Key was used for a different delivery posting");
      return { document: prior, replayed: true };
    }
    const document = await tx.salesDocument.findFirst({
      where: { id: documentId, companyId: actor.companyId, documentType: "DELIVERY_NOTE", status: "DRAFT" },
      include: {
        sourceDocument: { select: { documentType: true, status: true } },
        lines: { orderBy: { lineNumber: "asc" }, include: { sourceLine: true } },
      },
    });
    if (!document) throw new NotFoundError("Draft delivery note not found in the current company");
    if (document.sourceDocument &&
      (document.sourceDocument.documentType !== "SALES_ORDER" ||
        ["CANCELLED", "REVERSED", "REJECTED", "DRAFT"].includes(document.sourceDocument.status))) {
      throw new ConflictError("The source sales order is no longer available for delivery");
    }
    const accounts = await ensureSalesAccounts(tx, actor.companyId);
    const postingLines: { ledgerId: string; description: string; debit: string; credit: string }[] = [];
    const stockDetails: { line: typeof document.lines[number]; unitCost: Prisma.Decimal; value: Prisma.Decimal }[] = [];
    let cogs = decimal(0);
    for (const line of document.lines) {
      if (!line.itemId) throw new ValidationError("Delivery notes can only contain stock items");
      if (!line.warehouseId) throw new ValidationError(`Select a godown for ${line.description}`);
      if (line.sourceLineId) {
        const sourceLine = await tx.salesDocumentLine.findFirst({
          where: { id: line.sourceLineId, companyId: actor.companyId },
          select: { quantity: true },
        });
        if (!sourceLine) throw new NotFoundError("Delivery line source is not in the current company");
        const previousDeliveries = await tx.salesDocumentLine.findMany({
          where: {
            companyId: actor.companyId,
            sourceLineId: line.sourceLineId,
            document: { documentType: "DELIVERY_NOTE", status: "POSTED" },
          },
          select: { quantity: true },
        });
        const alreadyDelivered = previousDeliveries.reduce((sum, entry) => sum.plus(entry.quantity), decimal(0));
        if (alreadyDelivered.plus(line.quantity).greaterThan(sourceLine.quantity)) {
          throw new ConflictError(`Posting this delivery would exceed the ordered quantity for ${line.description}`);
        }
      }
      const batch = line.batchNumber
        ? await tx.inventoryBatch.findUnique({
            where: {
              companyId_itemId_warehouseId_batchNumber: {
                companyId: actor.companyId, itemId: line.itemId, warehouseId: line.warehouseId, batchNumber: line.batchNumber,
              },
            },
            select: { id: true },
          })
        : null;
      const balance = await tx.stockBalance.findFirst({
        where: {
          companyId: actor.companyId, itemId: line.itemId, warehouseId: line.warehouseId,
          locationKey: batch?.id ?? "NO_BATCH",
        },
        select: { quantity: true, value: true },
      });
      if (!balance || balance.quantity.lessThan(line.quantity) || balance.quantity.isZero()) {
        throw new ConflictError(`Insufficient stock for ${line.description} in the selected godown or batch`);
      }
      const unitCost = balance.value.div(balance.quantity).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const value = cents(line.quantity.mul(unitCost));
      cogs = cogs.plus(value);
      stockDetails.push({ line, unitCost, value });
      postingLines.push({
        ledgerId: accounts.accounts.get("COST_OF_GOODS_SOLD")!,
        description: `COGS · ${line.description} · ${document.documentNumber} · ${line.lineNumber}`,
        debit: value.toString(), credit: "0",
      });
      postingLines.push({
        ledgerId: accounts.inventoryLedgerId,
        description: `Stock · ${line.description} · ${document.documentNumber} · ${line.lineNumber}`,
        debit: "0", credit: value.toString(),
      });
    }
    if (!postingLines.length) throw new ValidationError("A delivery note must contain at least one stock item");
    if (cogs.isZero()) {
      throw new ConflictError("Delivery posting requires stock with a positive inventory value");
    }
    const voucher = await createPostedVoucherWithinTransaction(tx, actor, {
      type: "SALES",
      voucherDate: document.documentDate.toISOString().slice(0, 10),
      narration: `Delivery note ${document.documentNumber}`,
      idempotencyKey: hashIdempotencyKey(`${rawKey}:voucher`),
      requestHash,
      lines: postingLines,
      requestInfo,
    });
    const voucherLines = await tx.voucherLine.findMany({
      where: { companyId: actor.companyId, voucherId: voucher.id },
      select: { id: true, ledgerId: true, description: true },
    });
    for (const { line, unitCost } of stockDetails) {
      await tx.salesDocumentLine.update({ where: { id: line.id }, data: { unitCost } });
      const voucherLine = voucherLines.find((entry) =>
        entry.ledgerId === accounts.inventoryLedgerId && entry.description === `Stock · ${line.description} · ${document.documentNumber} · ${line.lineNumber}`,
      );
      if (!voucherLine) throw new Error("Posted delivery voucher is missing an inventory line");
      await tx.voucherStockDetail.create({
        data: {
          companyId: actor.companyId, voucherLineId: voucherLine.id, itemId: line.itemId!,
          warehouseId: line.warehouseId!, batchNumber: line.batchNumber,
          manufacturingDate: line.manufacturingDate, expiryDate: line.expiryDate,
          movementType: "SALES", direction: "OUT", quantity: line.quantity, unitCost,
        },
      });
      await postInventoryMovement(tx, actor, {
        itemId: line.itemId!,
        input: {
          warehouseId: line.warehouseId!, quantity: line.quantity.toString(), unitCost: unitCost.toString(),
          batchNumber: line.batchNumber ?? "",
          manufacturingDate: line.manufacturingDate?.toISOString().slice(0, 10) ?? "",
          expiryDate: line.expiryDate?.toISOString().slice(0, 10) ?? "",
        },
        date: document.documentDate.toISOString().slice(0, 10),
        type: "SALES", direction: "OUT", idempotencyKey: `${rawKey}:stock:${line.id}`,
        voucherId: voucher.id, requestInfo,
      });
    }
    for (const line of document.lines) {
      if (line.sourceLineId) {
        await tx.salesDocumentLine.update({
          where: { id: line.sourceLineId },
          data: { deliveredQuantity: { increment: line.quantity } },
        });
      }
    }
    const posted = await tx.salesDocument.update({
      where: { id: document.id },
      data: {
        status: "POSTED", voucherId: voucher.id, postedAt: new Date(),
        postIdempotencyKey: key, postRequestHash: requestHash, costOfGoodsSold: cents(cogs),
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    const sourceOrderId = document.sourceDocumentId;
    if (sourceOrderId) {
      const order = await tx.salesDocument.findFirst({
        where: { id: sourceOrderId, companyId: actor.companyId, documentType: "SALES_ORDER" },
        include: { lines: true },
      });
      if (order) {
        let allDelivered = true;
        let anyDelivered = false;
        for (const orderLine of order.lines) {
          const children = await tx.salesDocumentLine.findMany({
            where: {
              companyId: actor.companyId, sourceLineId: orderLine.id,
              document: { documentType: "DELIVERY_NOTE", status: "POSTED" },
            },
            select: { quantity: true },
          });
          const delivered = children.reduce((sum, child) => sum.plus(child.quantity), decimal(0));
          anyDelivered ||= delivered.greaterThan(0);
          if (delivered.lessThan(orderLine.quantity)) allDelivered = false;
        }
        await tx.salesDocument.update({
          where: { id: order.id },
          data: { status: allDelivered ? "DELIVERED" : anyDelivered ? "PARTIALLY_DELIVERED" : order.status },
        });
      }
    }
    await appendEvent(tx, actor, document.id, "DELIVERY_POSTED", `${key}:posted`, inputJson({
      voucherId: voucher.id, voucherNumber: voucher.voucherNumber, cogs: cents(cogs).toString(),
    }));
    await writeAuditLog({
      companyId: actor.companyId, actorId: actor.userId, action: "SALES_DELIVERY_POSTED",
      entityType: "SalesDocument", entityId: document.id,
      changes: inputJson({ voucherId: voucher.id, voucherNumber: voucher.voucherNumber, cogs: cents(cogs).toString() }),
      ...requestInfo,
    }, tx);
    return { document: posted, voucher, replayed: false };
  });
}

export async function postSalesDocument(
  actor: Actor,
  documentId: string,
  rawKey: string | null,
  requestInfo: RequestInfo,
) {
  const document = await withTransaction((tx) => tx.salesDocument.findFirst({
    where: { id: documentId, companyId: actor.companyId },
    select: { documentType: true },
  }));
  if (!document) throw new NotFoundError("Sales document not found in the current company");
  if (document.documentType === "SALES_INVOICE") {
    return postSalesInvoice(actor, documentId, rawKey, requestInfo);
  }
  if (document.documentType === "DELIVERY_NOTE") {
    return postSalesDelivery(actor, documentId, rawKey, requestInfo);
  }
  throw new ValidationError("Only delivery notes and sales invoices can be posted");
}

export async function cancelSalesDocument(
  actor: Actor,
  documentId: string,
  reversalDate: string,
  rawKey: string | null,
  reason: string,
  requestInfo: RequestInfo,
) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const bodyHash = digest({ documentId, reversalDate, reason });
  return withTransaction(async (tx) => {
    const prior = await tx.salesDocument.findUnique({
      where: { companyId_cancelIdempotencyKey: { companyId: actor.companyId, cancelIdempotencyKey: key } },
    });
    if (prior) {
      if (prior.cancelRequestHash !== bodyHash) throw new ConflictError("Idempotency-Key was used for different cancellation details");
      return { document: prior, replayed: true };
    }
    const document = await tx.salesDocument.findFirst({
      where: { id: documentId, companyId: actor.companyId },
      include: { lines: true },
    });
    if (!document) throw new NotFoundError("Sales document not found in the current company");
    if (["CANCELLED", "REVERSED"].includes(document.status)) {
      throw new ConflictError("This sales document has already been cancelled or reversed");
    }
    await assertNoActiveDescendants(tx, actor.companyId, document.id);
    let status: "CANCELLED" | "REVERSED" = "CANCELLED";
    if (document.status === "POSTED") {
      if (!document.voucherId) throw new Error("Posted sales document is missing its accounting voucher");
      status = "REVERSED";
      await reversePostedVoucher(
        actor,
        document.voucherId,
        reversalDate,
        `${rawKey}:reverse`,
        reason,
        requestInfo,
        tx,
      );
      for (const line of document.lines) {
        if (!line.sourceLineId) continue;
        const sourceLine = await tx.salesDocumentLine.findFirst({
          where: { id: line.sourceLineId, companyId: actor.companyId },
          select: { sourceLineId: true },
        });
        await tx.salesDocumentLine.update({
          where: { id: line.sourceLineId },
          data: document.documentType === "DELIVERY_NOTE"
            ? { deliveredQuantity: { decrement: line.quantity } }
            : { invoicedQuantity: { decrement: line.quantity } },
        });
        if (document.documentType === "SALES_INVOICE" && document.sourceDocumentId && sourceLine?.sourceLineId) {
          const parent = await tx.salesDocument.findFirst({
            where: { id: document.sourceDocumentId, companyId: actor.companyId },
            select: { documentType: true },
          });
          if (parent?.documentType === "DELIVERY_NOTE") {
            await tx.salesDocumentLine.update({
              where: { id: sourceLine.sourceLineId },
              data: { invoicedQuantity: { decrement: line.quantity } },
            });
          }
        }
      }
    }
    if (status === "REVERSED" && document.sourceDocumentId) {
      await refreshInvoiceProgress(tx, actor.companyId, document.sourceDocumentId);
    }
    const updated = await tx.salesDocument.update({
      where: { id: document.id },
      data: {
        status,
        cancelledAt: new Date(),
        cancelIdempotencyKey: key,
        cancelRequestHash: bodyHash,
      },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    await appendEvent(tx, actor, document.id, status === "REVERSED" ? "REVERSED" : "CANCELLED", `${key}:cancelled`, inputJson({
      previousStatus: document.status, status, reason, reversalDate,
    }));
    await writeAuditLog({
      companyId: actor.companyId, actorId: actor.userId, action: `SALES_DOCUMENT_${status}`,
      entityType: "SalesDocument", entityId: document.id,
      changes: inputJson({ previousStatus: document.status, status, reason, reversalDate }), ...requestInfo,
    }, tx);
    return { document: updated, replayed: false };
  });
}
