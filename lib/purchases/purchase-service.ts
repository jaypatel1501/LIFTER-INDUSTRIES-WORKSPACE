import { createHash } from "node:crypto";
import { Prisma, type PurchaseDocumentType } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { ensureDefaultChart } from "@/lib/accounting/default-chart";
import { createPostedVoucherWithinTransaction, reversePostedVoucher } from "@/lib/accounting/voucher-platform";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashIdempotencyKey } from "@/lib/idempotency";
import { postInventoryMovement } from "@/lib/inventory/post-movement";
import { withTransaction } from "@/lib/transactions";
import type { purchaseDocumentCreateSchema, purchaseConvertSchema, purchasePostSchema } from "@/lib/validation/purchases";
import type { z } from "zod";

type Actor = { companyId: string; userId: string };
type RequestInfo = { ipAddress?: string | undefined; userAgent?: string | undefined };
type CreateInput = z.infer<typeof purchaseDocumentCreateSchema>;
type ConvertInput = z.infer<typeof purchaseConvertSchema>;
type PostInput = z.infer<typeof purchasePostSchema>;
type PurchaseLineInput = CreateInput["lines"][number];

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

function taxesForLine(taxable: Prisma.Decimal, rate: Prisma.Decimal, intraState: boolean, unionTerritory: boolean) {
  if (!intraState) return {
    cgstRate: decimal(0), sgstRate: decimal(0), utgstRate: decimal(0), igstRate: rate,
    cgst: decimal(0), sgst: decimal(0), utgst: decimal(0), igst: cents(taxable.mul(rate).div(100)),
  };
  const halfRate = rate.div(2);
  const totalTax = cents(taxable.mul(rate).div(100));
  const first = totalTax.div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  return {
    cgstRate: halfRate, sgstRate: unionTerritory ? decimal(0) : halfRate,
    utgstRate: unionTerritory ? halfRate : decimal(0), igstRate: decimal(0),
    cgst: first, sgst: unionTerritory ? decimal(0) : totalTax.minus(first),
    utgst: unionTerritory ? totalTax.minus(first) : decimal(0), igst: decimal(0),
  };
}

function isUnionTerritory(code: string | null) {
  return ["04", "26", "31", "34", "35", "38"].includes(code ?? "");
}

async function nextNumber(tx: Prisma.TransactionClient, companyId: string, type: PurchaseDocumentType, documentDate: Date) {
  const periodKey = fiscalKey(documentDate);
  const prefixes: Record<PurchaseDocumentType, string> = {
    PURCHASE_ORDER: "PO", RECEIPT_NOTE: "GRN", PURCHASE_INVOICE: "PINV", PURCHASE_RETURN: "PRTN",
  };
  const series = await tx.purchaseNumberSeries.upsert({
    where: { companyId_documentType_periodKey: { companyId, documentType: type, periodKey } },
    create: { companyId, documentType: type, periodKey, prefix: `${prefixes[type]}-${periodKey}-` },
    update: {},
    select: { id: true, prefix: true, suffix: true, padding: true, nextNumber: true, isActive: true },
  });
  if (!series.isActive) throw new ConflictError("The purchase number series for this financial year is inactive");
  const allocated = await tx.purchaseNumberSeries.update({ where: { id: series.id }, data: { nextNumber: { increment: 1 } }, select: { nextNumber: true } });
  return { seriesId: series.id, number: `${series.prefix}${String(allocated.nextNumber - 1).padStart(series.padding, "0")}${series.suffix}` };
}

async function validatePurchaseDate(tx: Prisma.TransactionClient, companyId: string, documentDate: Date) {
  const [periodCount, financialYear, company] = await Promise.all([
    tx.financialYear.count({ where: { companyId } }),
    tx.financialYear.findFirst({ where: { companyId, startDate: { lte: documentDate }, endDate: { gte: documentDate } }, select: { status: true, booksBeginningDate: true } }),
    tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { booksBeginningDate: true } }),
  ]);
  if (periodCount && !financialYear) throw new ValidationError("Purchase document date must fall within a configured financial year");
  if (financialYear?.status === "CLOSED") throw new ConflictError("Purchase documents cannot be created in a closed financial year");
  const booksDate = financialYear?.booksBeginningDate ?? company.booksBeginningDate;
  if (booksDate && documentDate < booksDate) throw new ValidationError("Purchase document date cannot be before the books-beginning date");
}

async function resolveLines(
  tx: Prisma.TransactionClient,
  actor: Actor,
  supplier: { stateCode: string | null },
  company: { stateCode: string | null },
  lines: PurchaseLineInput[],
) {
  const intraState = Boolean(company.stateCode && company.stateCode === supplier.stateCode);
  const unionTerritory = isUnionTerritory(company.stateCode);
  const resolved = [];
  for (const [index, line] of lines.entries()) {
    const item = line.itemId ? await tx.stockItem.findFirst({
      where: { id: line.itemId, companyId: actor.companyId, isActive: true },
      select: { id: true, name: true, hsnSac: true, gstRate: true, baseUnit: { select: { symbol: true } } },
    }) : null;
    if (line.itemId && !item) throw new NotFoundError("A purchase item was not found in the active company");
    if (item && line.unit !== item.baseUnit.symbol) throw new ValidationError(`Purchase unit must be the item's base unit (${item.baseUnit.symbol})`);
    if (item && line.warehouseId) {
      const warehouse = await tx.warehouse.findFirst({ where: { id: line.warehouseId, companyId: actor.companyId, isActive: true }, select: { id: true } });
      if (!warehouse) throw new NotFoundError("An active godown was not found in the current company");
    }
    if (line.costCentreId) {
      const costCentre = await tx.costCentre.findFirst({ where: { id: line.costCentreId, companyId: actor.companyId, isActive: true }, select: { id: true } });
      if (!costCentre) throw new NotFoundError("An active cost centre was not found in the current company");
    }
    const quantity = decimal(line.quantity);
    const unitRate = decimal(line.unitRate);
    const gross = cents(quantity.mul(unitRate));
    const discountPercent = decimal(line.discountPercent ?? "0");
    const discountAmount = cents(gross.mul(discountPercent).div(100));
    const taxableAmount = gross.minus(discountAmount);
    if (taxableAmount.lessThanOrEqualTo(0)) throw new ValidationError("Each purchase line must have a positive taxable amount");
    const gstRate = line.gstRate !== undefined ? decimal(line.gstRate) : item?.gstRate ?? decimal(0);
    const tax = taxesForLine(taxableAmount, gstRate, intraState, unionTerritory);
    resolved.push({
      lineNumber: index + 1, itemId: item?.id ?? null, costCentreId: line.costCentreId || null,
      description: line.description.trim(), hsnSac: item?.hsnSac ?? null, unit: line.unit,
      quantity, unitRate, discountPercent, discountAmount, taxableAmount, gstRate,
      cgstRate: tax.cgstRate, sgstRate: tax.sgstRate, utgstRate: tax.utgstRate, igstRate: tax.igstRate,
      cgstAmount: tax.cgst, sgstAmount: tax.sgst, utgstAmount: tax.utgst, igstAmount: tax.igst,
      warehouseId: line.warehouseId || null, batchNumber: line.batchNumber || null,
      manufacturingDate: line.manufacturingDate ? date(line.manufacturingDate) : null,
      expiryDate: line.expiryDate ? date(line.expiryDate) : null,
      sourceLineId: line.sourceLineId ?? null, unitCost: null as Prisma.Decimal | null,
    });
  }
  return resolved;
}

async function appendEvent(tx: Prisma.TransactionClient, actor: Actor, documentId: string,
  eventType: "CREATED" | "ORDERED" | "RECEIPT_POSTED" | "INVOICE_POSTED" | "RETURN_POSTED" | "CANCELLED" | "REVERSED",
  idempotencyKey: string, snapshot: Prisma.InputJsonValue) {
  await tx.purchaseDocumentEvent.create({ data: { companyId: actor.companyId, documentId, actorId: actor.userId, eventType, idempotencyKey, snapshot } });
}

function aggregateAmounts(lines: Awaited<ReturnType<typeof resolveLines>>) {
  return {
    subtotal: cents(lines.reduce((sum, line) => sum.plus(line.quantity.mul(line.unitRate)), decimal(0))),
    discountAmount: cents(lines.reduce((sum, line) => sum.plus(line.discountAmount), decimal(0))),
    taxableAmount: cents(lines.reduce((sum, line) => sum.plus(line.taxableAmount), decimal(0))),
    cgstAmount: cents(lines.reduce((sum, line) => sum.plus(line.cgstAmount), decimal(0))),
    sgstAmount: cents(lines.reduce((sum, line) => sum.plus(line.sgstAmount), decimal(0))),
    utgstAmount: cents(lines.reduce((sum, line) => sum.plus(line.utgstAmount), decimal(0))),
    igstAmount: cents(lines.reduce((sum, line) => sum.plus(line.igstAmount), decimal(0))),
  };
}

async function createDraftInTransaction(tx: Prisma.TransactionClient, actor: Actor, input: CreateInput,
  key: string, bodyHash: string, sourceDocumentId: string | null, requestInfo: RequestInfo) {
  const [party, company] = await Promise.all([
    tx.party.findFirst({ where: { id: input.partyId, companyId: actor.companyId, type: "SUPPLIER", isActive: true } }),
    tx.company.findUniqueOrThrow({ where: { id: actor.companyId } }),
  ]);
  if (!party) throw new NotFoundError("Active supplier not found in the current company");
  const documentDate = date(input.documentDate);
  await validatePurchaseDate(tx, actor.companyId, documentDate);
  const lines = await resolveLines(tx, actor, party, company, input.lines);
  if (input.documentType === "PURCHASE_INVOICE" && lines.some((line) => line.itemId && !line.warehouseId)) {
    throw new ValidationError("Select a godown for every stock item on a purchase invoice");
  }
  const amounts = aggregateAmounts(lines);
  const freight = decimal(input.freight);
  const otherCharges = decimal(input.otherCharges);
  const roundOff = decimal(input.roundOff);
  const totalAmount = cents(amounts.taxableAmount.plus(amounts.cgstAmount).plus(amounts.sgstAmount).plus(amounts.utgstAmount)
    .plus(amounts.igstAmount).plus(freight).plus(otherCharges).plus(roundOff));
  if (totalAmount.lessThanOrEqualTo(0)) throw new ValidationError("Purchase document total must be greater than zero");
  const { seriesId, number } = await nextNumber(tx, actor.companyId, input.documentType, documentDate);
  const doc = await tx.purchaseDocument.create({
    data: {
      companyId: actor.companyId, documentNumber: number, documentType: input.documentType, status: "DRAFT",
      partyId: party.id, sourceDocumentId, numberSeriesId: seriesId, documentDate,
      dueDate: input.dueDate ? date(input.dueDate) : null,
      supplierInvoiceNumber: input.supplierInvoiceNumber || null,
      supplierInvoiceDate: input.supplierInvoiceDate ? date(input.supplierInvoiceDate) : null,
      paymentMode: input.paymentMode ?? null, paymentLedgerId: input.paymentLedgerId || null,
      companySnapshot: inputJson({ name: company.name, legalName: company.legalName, gstin: company.gstin, pan: company.pan,
        addressLine1: company.addressLine1, addressLine2: company.addressLine2, city: company.city, state: company.state,
        stateCode: company.stateCode, postalCode: company.postalCode }),
      partySnapshot: inputJson({ name: party.name, gstin: party.gstin, pan: party.pan, email: party.email, phone: party.phone,
        state: party.state, stateCode: party.stateCode }),
      notes: input.notes || null, ...amounts, freight, otherCharges, roundOff, totalAmount,
      idempotencyKey: key, requestHash: bodyHash, createdById: actor.userId,
      lines: { create: lines },
    },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  await appendEvent(tx, actor, doc.id, "CREATED", `${key}:created`, inputJson({ documentNumber: number, documentType: input.documentType }));
  await writeAuditLog({ companyId: actor.companyId, actorId: actor.userId, action: "PURCHASE_DOCUMENT_CREATED",
    entityType: "PurchaseDocument", entityId: doc.id,
    changes: inputJson({ documentNumber: number, documentType: input.documentType, totalAmount: totalAmount.toString() }), ...requestInfo,
  }, tx);
  return doc;
}

export async function createPurchaseDraft(actor: Actor, input: CreateInput, rawKey: string | null, requestInfo: RequestInfo) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const bodyHash = digest(input);
  return withTransaction(async (tx) => {
    const prior = await tx.purchaseDocument.findUnique({ where: { companyId_idempotencyKey: { companyId: actor.companyId, idempotencyKey: key } }, include: { lines: true } });
    if (prior) {
      if (prior.requestHash !== bodyHash) throw new ConflictError("Idempotency-Key was used for different purchase details");
      return { document: prior, replayed: true };
    }
    return { document: await createDraftInTransaction(tx, actor, input, key, bodyHash, null, requestInfo), replayed: false };
  });
}

export async function issuePurchaseOrder(actor: Actor, documentId: string, rawKey: string | null, requestInfo: RequestInfo) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const bodyHash = digest({ documentId, action: "issue" });
  return withTransaction(async (tx) => {
    const replay = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id: documentId, status: "ORDERED" } });
    if (replay) return { document: replay, replayed: true };
    const doc = await tx.purchaseDocument.findFirst({ where: { companyId: actor.companyId, id: documentId, documentType: "PURCHASE_ORDER", status: "DRAFT" } });
    if (!doc) throw new NotFoundError("Draft purchase order not found in the current company");
    const updated = await tx.purchaseDocument.update({ where: { id: doc.id }, data: { status: "ORDERED", issuedById: actor.userId, issuedAt: new Date() } });
    await appendEvent(tx, actor, doc.id, "ORDERED", key, inputJson({ previousStatus: doc.status, status: "ORDERED" }));
    await writeAuditLog({ companyId: actor.companyId, actorId: actor.userId, action: "PURCHASE_ORDER_ISSUED", entityType: "PurchaseDocument", entityId: doc.id,
      changes: inputJson({ documentId, previousStatus: doc.status, status: updated.status, requestHash: bodyHash }), ...requestInfo }, tx);
    return { document: updated, replayed: false };
  });
}

export async function convertPurchaseDocument(actor: Actor, sourceDocumentId: string, input: ConvertInput, rawKey: string | null, requestInfo: RequestInfo) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const bodyHash = digest({ sourceDocumentId, input });
  return withTransaction(async (tx) => {
    const prior = await tx.purchaseDocument.findUnique({ where: { companyId_idempotencyKey: { companyId: actor.companyId, idempotencyKey: key } }, include: { lines: true } });
    if (prior) {
      if (prior.requestHash !== bodyHash) throw new ConflictError("Idempotency-Key was used for different purchase conversion details");
      return { document: prior, replayed: true };
    }
    const source = await tx.purchaseDocument.findFirst({ where: { id: sourceDocumentId, companyId: actor.companyId }, include: { party: true, lines: { orderBy: { lineNumber: "asc" } } } });
    if (!source) throw new NotFoundError("Source purchase document not found in the current company");
    const allowed = source.documentType === "PURCHASE_ORDER"
      ? ["RECEIPT_NOTE", "PURCHASE_INVOICE"].includes(input.documentType) && ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "PARTIALLY_INVOICED"].includes(source.status)
      : source.documentType === "RECEIPT_NOTE"
        ? input.documentType === "PURCHASE_INVOICE" && source.status === "POSTED"
        : source.documentType === "PURCHASE_INVOICE" && input.documentType === "PURCHASE_RETURN" && source.status === "POSTED";
    if (!allowed) throw new ConflictError("This purchase document cannot be converted to the selected next step");
    const selected = new Map(source.lines.map((line) => [line.id, line]));
    const sourceDocument = source.documentType === "PURCHASE_ORDER" ? source : source.documentType === "RECEIPT_NOTE" ? source.sourceDocumentId : source.id;
    const company = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId } });
    await validatePurchaseDate(tx, actor.companyId, date(input.documentDate));
    const rawLines: PurchaseLineInput[] = [];
    for (const requested of input.lines) {
      const parentLine = selected.get(requested.sourceLineId);
      if (!parentLine) throw new NotFoundError("A source line does not belong to the selected purchase document");
      if (input.documentType === "RECEIPT_NOTE" && parentLine.receivedQuantity.plus(requested.quantity).greaterThan(parentLine.quantity)) {
        throw new ConflictError(`Receipt quantity exceeds the remaining order quantity for ${parentLine.description}`);
      }
      if (input.documentType === "PURCHASE_INVOICE" && source.documentType === "PURCHASE_ORDER" && parentLine.invoicedQuantity.plus(requested.quantity).greaterThan(parentLine.quantity)) {
        throw new ConflictError(`Invoice quantity exceeds the remaining order quantity for ${parentLine.description}`);
      }
      if (input.documentType === "PURCHASE_INVOICE" && source.documentType === "PURCHASE_ORDER" &&
        parentLine.receivedQuantity.greaterThan(parentLine.invoicedQuantity)) {
        throw new ConflictError(`Invoice already-received quantities through the receipt note for ${parentLine.description}`);
      }
      if (input.documentType === "PURCHASE_INVOICE" && source.documentType === "RECEIPT_NOTE" && parentLine.invoicedQuantity.plus(requested.quantity).greaterThan(parentLine.quantity)) {
        throw new ConflictError(`Invoice quantity exceeds the remaining receipt quantity for ${parentLine.description}`);
      }
      if (input.documentType === "PURCHASE_RETURN") {
        const alreadyReturned = await tx.purchaseDocumentLine.aggregate({
          where: { companyId: actor.companyId, sourceLineId: parentLine.id, document: { documentType: "PURCHASE_RETURN", status: "POSTED" } },
          _sum: { quantity: true },
        });
        if ((alreadyReturned._sum.quantity ?? decimal(0)).plus(requested.quantity).greaterThan(parentLine.quantity)) {
          throw new ConflictError(`Return quantity exceeds the remaining invoice quantity for ${parentLine.description}`);
        }
      }
      rawLines.push({
        itemId: parentLine.itemId ?? undefined, sourceLineId: parentLine.id, costCentreId: parentLine.costCentreId ?? undefined,
        description: parentLine.description, unit: parentLine.unit, quantity: requested.quantity, unitRate: parentLine.unitRate.toString(),
        discountPercent: parentLine.discountPercent.toString(), gstRate: parentLine.gstRate.toString(),
        warehouseId: requested.warehouseId ?? parentLine.warehouseId ?? undefined,
        batchNumber: requested.batchNumber ?? parentLine.batchNumber ?? "",
        manufacturingDate: requested.manufacturingDate ?? parentLine.manufacturingDate?.toISOString().slice(0, 10) ?? "",
        expiryDate: requested.expiryDate ?? parentLine.expiryDate?.toISOString().slice(0, 10) ?? "",
      });
    }
    const lines = await resolveLines(tx, actor, source.party, company, rawLines);
    for (const [index, line] of lines.entries()) {
      const parentLine = selected.get(rawLines[index]!.sourceLineId!)!;
      if (input.documentType === "PURCHASE_INVOICE" && source.documentType === "RECEIPT_NOTE") line.unitCost = parentLine.unitCost;
      if (input.documentType === "PURCHASE_RETURN") line.unitCost = parentLine.unitCost;
      if (line.itemId && !line.warehouseId) throw new ValidationError(`Select a godown for ${line.description}`);
    }
    const amounts = aggregateAmounts(lines);
    const freight = decimal(0);
    const otherCharges = decimal(0);
    const roundOff = decimal(0);
    const totalAmount = cents(amounts.taxableAmount.plus(amounts.cgstAmount).plus(amounts.sgstAmount).plus(amounts.utgstAmount).plus(amounts.igstAmount));
    const type = input.documentType;
    const { seriesId, number } = await nextNumber(tx, actor.companyId, type, date(input.documentDate));
    const supplierInvoiceNumber = input.supplierInvoiceNumber || null;
    const supplierInvoiceDate = input.supplierInvoiceDate ? date(input.supplierInvoiceDate) : null;
    const dueDate = input.dueDate ? date(input.dueDate) : type === "PURCHASE_INVOICE" ? new Date(date(input.documentDate).getTime() + source.party.creditPeriodDays * 86_400_000) : null;
    const created = await tx.purchaseDocument.create({
      data: {
        companyId: actor.companyId, documentNumber: number, documentType: type, status: "DRAFT", partyId: source.partyId,
        sourceDocumentId: source.id, numberSeriesId: seriesId, documentDate: date(input.documentDate), dueDate,
        supplierInvoiceNumber, supplierInvoiceDate, paymentMode: input.paymentMode ?? null, paymentLedgerId: input.paymentLedgerId || null,
        companySnapshot: inputJson({ name: company.name, legalName: company.legalName, gstin: company.gstin, stateCode: company.stateCode }),
        partySnapshot: inputJson({ name: source.party.name, gstin: source.party.gstin, state: source.party.state, stateCode: source.party.stateCode }),
        notes: source.notes, ...amounts, freight, otherCharges, roundOff, totalAmount,
        idempotencyKey: key, requestHash: bodyHash, createdById: actor.userId,
        lines: { create: lines },
      }, include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    await appendEvent(tx, actor, created.id, "CREATED", `${key}:created`, inputJson({ sourceDocumentId: source.id, documentNumber: number, documentType: type }));
    await writeAuditLog({ companyId: actor.companyId, actorId: actor.userId, action: `PURCHASE_${type}_CREATED`, entityType: "PurchaseDocument", entityId: created.id,
      changes: inputJson({ sourceDocumentId: source.id, documentNumber: number }), ...requestInfo }, tx);
    void sourceDocument;
    return { document: created, replayed: false };
  });
}

async function ensurePurchaseAccounts(tx: Prisma.TransactionClient, companyId: string) {
  const chart = await ensureDefaultChart(tx, companyId);
  await tx.ledger.update({ where: { id: chart.inventoryLedgerId }, data: { costCentreEnabled: true } });
  const accounts = new Map<string, string>();
  const definitions = [
    { code: "PURCHASE_EXPENSE", name: "Purchase Expense", groupId: chart.groups.get("DIRECT_EXPENSES")!, type: "EXPENSE" as const, costCentreEnabled: true },
    { code: "GOODS_RECEIVED_NOT_INVOICED", name: "Goods Received Not Invoiced", groupId: chart.groups.get("CURRENT_LIABILITIES")!, type: "GENERAL" as const, costCentreEnabled: false },
    { code: "INPUT_CGST", name: "Input CGST", groupId: chart.groups.get("CURRENT_ASSETS")!, type: "TAX" as const, costCentreEnabled: false },
    { code: "INPUT_SGST", name: "Input SGST", groupId: chart.groups.get("CURRENT_ASSETS")!, type: "TAX" as const, costCentreEnabled: false },
    { code: "INPUT_UTGST", name: "Input UTGST", groupId: chart.groups.get("CURRENT_ASSETS")!, type: "TAX" as const, costCentreEnabled: false },
    { code: "INPUT_IGST", name: "Input IGST", groupId: chart.groups.get("CURRENT_ASSETS")!, type: "TAX" as const, costCentreEnabled: false },
  ];
  for (const account of definitions) {
    const ledger = await tx.ledger.upsert({
      where: { companyId_code: { companyId, code: account.code } },
      create: { companyId, name: account.name, code: account.code, groupId: account.groupId, type: account.type,
        costCentreEnabled: account.costCentreEnabled, isSystem: true, creationKey: `system:${account.code.toLowerCase()}`, creationHash: "system" },
      update: {}, select: { id: true },
    });
    accounts.set(account.code, ledger.id);
  }
  return { inventoryLedgerId: chart.inventoryLedgerId, accounts };
}

async function supplierLedger(tx: Prisma.TransactionClient, companyId: string, partyId: string) {
  const party = await tx.party.findFirst({ where: { id: partyId, companyId, type: "SUPPLIER", isActive: true }, select: { id: true, name: true, ledger: { select: { id: true, isActive: true } } } });
  if (!party) throw new NotFoundError("Active supplier not found in the current company");
  if (party.ledger) {
    if (!party.ledger.isActive) throw new ValidationError("The supplier's linked ledger is inactive");
    return party.ledger.id;
  }
  const group = await tx.ledgerGroup.findFirst({ where: { companyId, code: "SUNDRY_CREDITORS" }, select: { id: true } });
  if (!group) throw new ValidationError("Supplier ledger group is not configured");
  const ledger = await tx.ledger.create({ data: { companyId, groupId: group.id, partyId: party.id, name: party.name, type: "PARTY",
    creationKey: `party:${party.id}`, creationHash: digest({ partyId: party.id }), costCentreEnabled: false }, select: { id: true } });
  return ledger.id;
}

function allocateFreight(lines: { id: string; itemId: string | null; taxableAmount: Prisma.Decimal; quantity: Prisma.Decimal }[], freight: Prisma.Decimal) {
  const stock = lines.filter((line) => line.itemId);
  const base = stock.reduce((sum, line) => sum.plus(line.taxableAmount), decimal(0));
  let allocated = decimal(0);
  return new Map(stock.map((line, index) => {
    const value = index === stock.length - 1 ? freight.minus(allocated) : base.isZero() ? decimal(0) : cents(freight.mul(line.taxableAmount).div(base));
    allocated = allocated.plus(value);
    return [line.id, value] as const;
  }));
}

async function updateSourceProgress(tx: Prisma.TransactionClient, companyId: string, sourceId: string) {
  const source = await tx.purchaseDocument.findFirst({ where: { id: sourceId, companyId }, include: { lines: { select: { quantity: true, receivedQuantity: true, invoicedQuantity: true } } } });
  if (!source || source.documentType !== "PURCHASE_ORDER") return;
  const receivedSome = source.lines.some((line) => line.receivedQuantity.greaterThan(0));
  const receivedAll = source.lines.length > 0 && source.lines.every((line) => line.receivedQuantity.greaterThanOrEqualTo(line.quantity));
  const invoicedSome = source.lines.some((line) => line.invoicedQuantity.greaterThan(0));
  const invoicedAll = source.lines.length > 0 && source.lines.every((line) => line.invoicedQuantity.greaterThanOrEqualTo(line.quantity));
  await tx.purchaseDocument.update({ where: { id: source.id }, data: { status: invoicedAll ? "INVOICED" : invoicedSome ? "PARTIALLY_INVOICED" : receivedAll ? "RECEIVED" : receivedSome ? "PARTIALLY_RECEIVED" : "ORDERED" } });
}

export async function postPurchaseDocument(actor: Actor, documentId: string, input: PostInput, rawKey: string | null, requestInfo: RequestInfo) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const requestHash = digest({ documentId, input, action: "post" });
  return withTransaction(async (tx) => {
    const prior = await tx.purchaseDocument.findUnique({ where: { companyId_postIdempotencyKey: { companyId: actor.companyId, postIdempotencyKey: key } }, include: { lines: true } });
    if (prior) {
      if (prior.postRequestHash !== requestHash) throw new ConflictError("Idempotency-Key was used for different purchase posting details");
      return { document: prior, replayed: true };
    }
    const document = await tx.purchaseDocument.findFirst({ where: { id: documentId, companyId: actor.companyId, status: "DRAFT" },
      include: { party: true, sourceDocument: { select: { id: true, documentType: true, status: true, supplierInvoiceNumber: true, paymentMode: true, paymentLedgerId: true, voucherId: true } }, lines: { orderBy: { lineNumber: "asc" }, include: { sourceLine: true } } } });
    if (!document) throw new NotFoundError("Draft purchase document not found in the current company");
    if (!["RECEIPT_NOTE", "PURCHASE_INVOICE", "PURCHASE_RETURN"].includes(document.documentType)) throw new ValidationError("Issue a purchase order before converting it to a receipt or invoice");
    if (document.documentType === "RECEIPT_NOTE" && document.sourceDocument && !["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "PARTIALLY_INVOICED"].includes(document.sourceDocument.status)) throw new ConflictError("The source purchase order is not available for receipt");
    if (document.documentType === "PURCHASE_INVOICE" && (!document.supplierInvoiceNumber || !document.supplierInvoiceDate)) throw new ValidationError("Supplier invoice number and date are required before posting");
    if (document.documentType === "PURCHASE_INVOICE" && !input.paymentMode) throw new ValidationError("Select cash or credit payment before posting the purchase invoice");
    if (document.totalAmount.lessThanOrEqualTo(0)) throw new ValidationError("A purchase document total must be greater than zero");
    const chart = await ensurePurchaseAccounts(tx, actor.companyId);
    const partyLedgerId = await supplierLedger(tx, actor.companyId, document.partyId);
    const paymentMode = input.paymentMode ?? document.paymentMode;
    const paymentLedgerId = input.paymentLedgerId ?? document.paymentLedgerId;
    if (document.documentType === "PURCHASE_INVOICE" && paymentMode === "CASH") {
      const ledger = await tx.ledger.findFirst({ where: { id: paymentLedgerId ?? "", companyId: actor.companyId, isActive: true, type: { in: ["CASH", "BANK"] } }, select: { id: true } });
      if (!ledger) throw new ValidationError("Choose an active cash or bank ledger for this company");
    }
    if (document.documentType === "PURCHASE_RETURN" && document.sourceDocument?.documentType !== "PURCHASE_INVOICE") throw new ValidationError("Purchase returns must reference a posted supplier invoice");
    const debitLines: { ledgerId: string; description: string; debit: string; credit: string }[] = [];
    const creditLines: { ledgerId: string; description: string; debit: string; credit: string }[] = [];
    const costs = new Map<string, Prisma.Decimal>();
    const stockLineData: { line: typeof document.lines[number]; unitCost: Prisma.Decimal; quantity: Prisma.Decimal; value: Prisma.Decimal; direction: "IN" | "OUT"; type: "PURCHASE" | "PURCHASE_RETURN" }[] = [];
    const voucherDate = document.documentDate.toISOString().slice(0, 10);
    const addInputTax = (side: "DEBIT" | "CREDIT") => {
      for (const [kind, code, amount] of [["CGST", "INPUT_CGST", document.cgstAmount], ["SGST", "INPUT_SGST", document.sgstAmount], ["UTGST", "INPUT_UTGST", document.utgstAmount], ["IGST", "INPUT_IGST", document.igstAmount]] as const) {
        if (amount.isZero()) continue;
        const line = { ledgerId: chart.accounts.get(code)!, description: `${side === "DEBIT" ? "Input" : "Reversal of input"} ${kind} · ${document.documentNumber}`,
          debit: side === "DEBIT" ? amount.toString() : "0", credit: side === "CREDIT" ? amount.toString() : "0" };
        (side === "DEBIT" ? debitLines : creditLines).push(line);
      }
    };
    const freightByLine = allocateFreight(document.lines, document.freight);
    if (document.documentType === "RECEIPT_NOTE") {
      if (document.lines.some((line) => !line.itemId || !line.warehouseId)) throw new ValidationError("Receipt notes can only contain stock items with a selected godown");
      const grni = chart.accounts.get("GOODS_RECEIVED_NOT_INVOICED")!;
      let receiptValue = decimal(0);
      for (const line of document.lines) {
        const freightShare = freightByLine.get(line.id) ?? decimal(0);
        const value = cents(line.taxableAmount.plus(freightShare));
        const unitCost = value.div(line.quantity).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
        costs.set(line.id, unitCost);
        receiptValue = receiptValue.plus(value);
        debitLines.push({ ledgerId: chart.inventoryLedgerId, description: `Received stock · ${document.documentNumber} · ${line.lineNumber}`, debit: value.toString(), credit: "0" });
        creditLines.push({ ledgerId: grni, description: `Receipt accrual · ${document.documentNumber}`, debit: "0", credit: value.toString() });
        stockLineData.push({ line, unitCost, quantity: line.quantity, value, direction: "IN", type: "PURCHASE" });
      }
      if (receiptValue.isZero()) throw new ValidationError("Receipt note must include stock items");
    } else if (document.documentType === "PURCHASE_INVOICE") {
      const fromReceipt = document.sourceDocument?.documentType === "RECEIPT_NOTE";
      if (fromReceipt && document.sourceDocument?.status !== "POSTED") throw new ConflictError("The source receipt note is not posted");
      if (!fromReceipt) {
        if (document.freight.greaterThan(0) && !document.lines.some((line) => line.itemId)) {
          debitLines.push({ ledgerId: chart.accounts.get("PURCHASE_EXPENSE")!, description: `Freight expense · ${document.documentNumber}`, debit: document.freight.toString(), credit: "0" });
        }
        for (const line of document.lines) {
          if (!line.itemId) {
            const ledgerId = chart.accounts.get("PURCHASE_EXPENSE")!;
            debitLines.push({ ledgerId, description: `Purchase expense · ${document.documentNumber} · ${line.lineNumber}`, debit: line.taxableAmount.toString(), credit: "0" });
          } else {
            if (!line.warehouseId) throw new ValidationError(`Select a godown for ${line.description}`);
            if (line.batchNumber === null && (await tx.stockItem.findFirst({ where: { id: line.itemId, companyId: actor.companyId, batchTracked: true }, select: { id: true } }))) throw new ValidationError(`A batch number is required for ${line.description}`);
            const value = cents(line.taxableAmount.plus(freightByLine.get(line.id) ?? decimal(0)));
            const unitCost = value.div(line.quantity).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
            costs.set(line.id, unitCost);
            debitLines.push({ ledgerId: chart.inventoryLedgerId, description: `Purchased stock · ${document.documentNumber} · ${line.lineNumber}`, debit: value.toString(), credit: "0" });
            stockLineData.push({ line, unitCost, quantity: line.quantity, value, direction: "IN", type: "PURCHASE" });
          }
        }
      } else {
        const grni = chart.accounts.get("GOODS_RECEIVED_NOT_INVOICED")!;
        let accrual = decimal(0);
        for (const line of document.lines) {
          if (!line.itemId || !line.sourceLine?.unitCost) throw new ConflictError(`The source receipt is missing stock cost for ${line.description}`);
          const value = cents(line.quantity.mul(line.sourceLine.unitCost));
          accrual = accrual.plus(value);
          costs.set(line.id, line.sourceLine.unitCost);
          debitLines.push({ ledgerId: grni, description: `Receipt accrual cleared · ${document.documentNumber} · ${line.lineNumber}`, debit: value.toString(), credit: "0" });
        }
        const invoiceNet = cents(document.taxableAmount.plus(document.freight));
        const variance = invoiceNet.minus(accrual);
        if (variance.greaterThan(0)) debitLines.push({ ledgerId: chart.accounts.get("PURCHASE_EXPENSE")!, description: `Purchase price variance · ${document.documentNumber}`, debit: variance.toString(), credit: "0" });
        if (variance.lessThan(0)) creditLines.push({ ledgerId: chart.accounts.get("PURCHASE_EXPENSE")!, description: `Purchase price variance · ${document.documentNumber}`, debit: "0", credit: variance.abs().toString() });
      }
      if (document.otherCharges.greaterThan(0)) debitLines.push({ ledgerId: chart.accounts.get("PURCHASE_EXPENSE")!, description: `Other purchase charges · ${document.documentNumber}`, debit: document.otherCharges.toString(), credit: "0" });
      addInputTax("DEBIT");
      if (document.roundOff.greaterThan(0)) debitLines.push({ ledgerId: chart.accounts.get("PURCHASE_EXPENSE")!, description: `Purchase round-off · ${document.documentNumber}`, debit: document.roundOff.toString(), credit: "0" });
      if (document.roundOff.lessThan(0)) creditLines.push({ ledgerId: chart.accounts.get("PURCHASE_EXPENSE")!, description: `Purchase round-off · ${document.documentNumber}`, debit: "0", credit: document.roundOff.abs().toString() });
      const creditLedgerId = paymentMode === "CASH" ? paymentLedgerId! : partyLedgerId;
      creditLines.push({ ledgerId: creditLedgerId, description: `${paymentMode === "CASH" ? "Cash purchase" : "Supplier payable"} · ${document.supplierInvoiceNumber}`,
        debit: "0", credit: document.totalAmount.toString() });
    } else {
      const sourceInvoice = document.sourceDocument;
      if (!sourceInvoice || sourceInvoice.status !== "POSTED") throw new ConflictError("The source supplier invoice is not posted");
      const refundLedgerId = sourceInvoice.paymentMode === "CASH" ? sourceInvoice.paymentLedgerId : partyLedgerId;
      if (!refundLedgerId) throw new ConflictError("The original cash purchase has no settlement ledger");
      if (sourceInvoice.paymentMode === "CASH") {
        const activeCashLedger = await tx.ledger.findFirst({ where: { id: refundLedgerId, companyId: actor.companyId, isActive: true, type: { in: ["CASH", "BANK"] } }, select: { id: true } });
        if (!activeCashLedger) throw new ConflictError("The original cash purchase ledger is no longer active");
      }
      debitLines.push({ ledgerId: refundLedgerId, description: `Supplier return · ${sourceInvoice.supplierInvoiceNumber ?? sourceInvoice.id}`, debit: document.totalAmount.toString(), credit: "0" });
      for (const line of document.lines) {
        if (!line.itemId || !line.warehouseId) throw new ValidationError("Purchase returns require a stock item and godown on every line");
        const unitCost = line.unitCost ?? line.sourceLine?.unitCost;
        if (!unitCost) throw new ConflictError(`The source invoice has no inventory cost for ${line.description}`);
        const value = cents(line.quantity.mul(unitCost));
        costs.set(line.id, unitCost);
        creditLines.push({ ledgerId: chart.inventoryLedgerId, description: `Returned stock · ${document.documentNumber} · ${line.lineNumber}`, debit: "0", credit: value.toString() });
        stockLineData.push({ line, unitCost, quantity: line.quantity, value, direction: "OUT", type: "PURCHASE_RETURN" });
      }
      addInputTax("CREDIT");
      const lineValue = stockLineData.reduce((sum, entry) => sum.plus(entry.value), decimal(0));
      const difference = document.totalAmount.minus(lineValue).minus(document.cgstAmount).minus(document.sgstAmount).minus(document.utgstAmount).minus(document.igstAmount);
      if (difference.greaterThan(0)) creditLines.push({ ledgerId: chart.accounts.get("PURCHASE_EXPENSE")!, description: `Purchase return charges · ${document.documentNumber}`, debit: "0", credit: difference.toString() });
      if (difference.lessThan(0)) debitLines.push({ ledgerId: chart.accounts.get("PURCHASE_EXPENSE")!, description: `Purchase return price variance · ${document.documentNumber}`, debit: difference.abs().toString(), credit: "0" });
    }
    const voucherLines = [...debitLines, ...creditLines];
    const voucher = await createPostedVoucherWithinTransaction(tx, actor, {
      type: "PURCHASE", voucherDate, narration: `${document.documentType.replaceAll("_", " ")} ${document.documentNumber}`,
      idempotencyKey: hashIdempotencyKey(`${rawKey}:voucher`), requestHash, lines: voucherLines, requestInfo,
    });
    const persistedLines = await tx.voucherLine.findMany({ where: { companyId: actor.companyId, voucherId: voucher.id }, orderBy: { lineNumber: "asc" }, select: { id: true, ledgerId: true, description: true } });
    const taxSpecs = [
      ["CGST", "INPUT_CGST", document.cgstAmount], ["SGST", "INPUT_SGST", document.sgstAmount],
      ["UTGST", "INPUT_UTGST", document.utgstAmount], ["IGST", "INPUT_IGST", document.igstAmount],
    ] as const;
    for (const taxLine of taxSpecs) {
      const [type, code, amount] = taxLine;
      if (amount.isZero()) continue;
      const persisted = persistedLines.find((line) => line.ledgerId === chart.accounts.get(code));
      if (!persisted) continue;
      const taxRate = document.taxableAmount.isZero() ? decimal(0) : amount.mul(100).div(document.taxableAmount).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      await tx.voucherTaxDetail.create({ data: { companyId: actor.companyId, voucherLineId: persisted.id, taxLedgerId: persisted.ledgerId,
        taxType: type, taxableAmount: document.taxableAmount, taxAmount: amount, rate: taxRate } });
      await tx.taxTransaction.create({ data: { companyId: actor.companyId, voucherId: voucher.id, voucherLineId: persisted.id,
        ledgerId: persisted.ledgerId, taxType: type, taxableAmount: document.taxableAmount, taxAmount: amount, rate: taxRate,
        transactionDate: document.documentDate, isReversal: document.documentType === "PURCHASE_RETURN" } });
    }
    for (const data of stockLineData) {
      const persisted = persistedLines.find((line) => (line.description ?? "").endsWith(`· ${data.line.lineNumber}`) && line.ledgerId === chart.inventoryLedgerId);
      if (persisted) await tx.voucherStockDetail.create({ data: { companyId: actor.companyId, voucherLineId: persisted.id,
        itemId: data.line.itemId!, warehouseId: data.line.warehouseId!, batchNumber: data.line.batchNumber,
        manufacturingDate: data.line.manufacturingDate, expiryDate: data.line.expiryDate,
        movementType: data.type, direction: data.direction, quantity: data.quantity, unitCost: data.unitCost } });
      await postInventoryMovement(tx, actor, {
        itemId: data.line.itemId!, input: { warehouseId: data.line.warehouseId!, quantity: data.quantity.toString(), unitCost: data.unitCost.toString(),
          batchNumber: data.line.batchNumber ?? "", manufacturingDate: data.line.manufacturingDate?.toISOString().slice(0, 10) ?? "",
          expiryDate: data.line.expiryDate?.toISOString().slice(0, 10) ?? "" },
        date: voucherDate, type: data.type, direction: data.direction, idempotencyKey: `${rawKey}:stock:${data.line.id}`, voucherId: voucher.id, requestInfo,
      });
      await tx.purchaseDocumentLine.update({ where: { id: data.line.id }, data: { unitCost: data.unitCost } });
    }
    for (const line of document.lines) {
      if (!line.costCentreId) continue;
      const detail = persistedLines.find((entry) => (entry.description ?? "").endsWith(`· ${line.lineNumber}`) && (entry.ledgerId === chart.inventoryLedgerId || entry.ledgerId === chart.accounts.get("PURCHASE_EXPENSE")));
      if (detail && (costs.get(line.id) || line.taxableAmount).greaterThan(0)) {
        const allocation = costs.get(line.id)?.mul(line.quantity) ?? line.taxableAmount;
        await tx.costAllocation.create({ data: { companyId: actor.companyId, voucherId: voucher.id, voucherLineId: detail.id, costCentreId: line.costCentreId, amount: cents(allocation) } });
      }
    }
    if (document.documentType === "PURCHASE_INVOICE" && paymentMode === "CREDIT") {
      const payableLine = persistedLines.find((line) => line.ledgerId === partyLedgerId);
      if (payableLine) await tx.billWiseEntry.create({ data: { companyId: actor.companyId, voucherId: voucher.id, voucherLineId: payableLine.id,
        referenceType: "NEW", referenceNumber: document.supplierInvoiceNumber, dueDate: input.dueDate ? date(input.dueDate) : document.dueDate,
        amount: document.totalAmount, settledAmount: decimal(0), remainingAmount: document.totalAmount } });
    }
    if (document.documentType === "PURCHASE_RETURN" && document.sourceDocument?.paymentMode !== "CASH") {
      const payableLine = persistedLines.find((line) => line.ledgerId === partyLedgerId);
      const bill = document.sourceDocument?.voucherId ? await tx.billWiseEntry.findFirst({ where: {
        companyId: actor.companyId, voucherId: document.sourceDocument.voucherId, referenceType: "NEW", voucherLine: { ledgerId: partyLedgerId },
      }, select: { id: true, referenceNumber: true, remainingAmount: true } }) : null;
      if (!bill) throw new ConflictError("The supplier invoice has no linked bill-wise payable reference");
      if (payableLine) {
        const againstAmount = Prisma.Decimal.min(document.totalAmount, bill.remainingAmount);
        const onAccountAmount = document.totalAmount.minus(againstAmount);
        if (againstAmount.greaterThan(0)) {
          const updatedBill = await tx.billWiseEntry.updateMany({ where: { id: bill.id, companyId: actor.companyId, remainingAmount: { gte: againstAmount } },
            data: { settledAmount: { increment: againstAmount }, remainingAmount: { decrement: againstAmount } } });
          if (updatedBill.count !== 1) throw new ConflictError("Supplier bill balance changed while posting the return");
          await tx.billWiseEntry.create({ data: { companyId: actor.companyId, voucherId: voucher.id, voucherLineId: payableLine.id,
            referenceType: "AGAINST_REF", referenceNumber: bill.referenceNumber,
            settlesEntryId: bill.id, dueDate: null, amount: againstAmount, settledAmount: decimal(0), remainingAmount: decimal(0) } });
        }
        if (onAccountAmount.greaterThan(0)) await tx.billWiseEntry.create({ data: { companyId: actor.companyId, voucherId: voucher.id, voucherLineId: payableLine.id,
          referenceType: "ON_ACCOUNT", referenceNumber: null, dueDate: null, amount: onAccountAmount, settledAmount: decimal(0), remainingAmount: decimal(0) } });
      }
    }
    if (document.sourceDocumentId && ["RECEIPT_NOTE", "PURCHASE_INVOICE"].includes(document.documentType)) {
      const parent = await tx.purchaseDocument.findFirst({ where: { id: document.sourceDocumentId, companyId: actor.companyId }, select: { documentType: true, sourceDocumentId: true } });
      for (const line of document.lines) {
        if (!line.sourceLineId) continue;
        await tx.purchaseDocumentLine.update({ where: { id: line.sourceLineId }, data: document.documentType === "RECEIPT_NOTE"
          ? { receivedQuantity: { increment: line.quantity } }
          : parent?.documentType === "PURCHASE_ORDER"
            ? { invoicedQuantity: { increment: line.quantity }, receivedQuantity: { increment: line.quantity } }
            : { invoicedQuantity: { increment: line.quantity } } });
        if (document.documentType === "PURCHASE_INVOICE" && parent?.documentType === "RECEIPT_NOTE" && parent.sourceDocumentId) {
          const poLineId = await tx.purchaseDocumentLine.findFirst({ where: { id: line.sourceLineId, companyId: actor.companyId }, select: { sourceLineId: true } });
          if (poLineId?.sourceLineId) await tx.purchaseDocumentLine.update({ where: { id: poLineId.sourceLineId }, data: { invoicedQuantity: { increment: line.quantity } } });
        }
      }
      await updateSourceProgress(tx, actor.companyId, parent?.documentType === "RECEIPT_NOTE" ? parent.sourceDocumentId ?? document.sourceDocumentId : document.sourceDocumentId);
    }
    const updated = await tx.purchaseDocument.update({ where: { id: document.id }, data: {
      status: "POSTED", voucherId: voucher.id, paymentMode: paymentMode ?? null, paymentLedgerId: paymentLedgerId ?? null,
      dueDate: input.dueDate ? date(input.dueDate) : document.dueDate, postedAt: new Date(), postIdempotencyKey: key, postRequestHash: requestHash,
    }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
    const event = document.documentType === "RECEIPT_NOTE" ? "RECEIPT_POSTED" : document.documentType === "PURCHASE_RETURN" ? "RETURN_POSTED" : "INVOICE_POSTED";
    await appendEvent(tx, actor, document.id, event, `${key}:posted`, inputJson({ voucherId: voucher.id, voucherNumber: voucher.voucherNumber, total: document.totalAmount.toString() }));
    await writeAuditLog({ companyId: actor.companyId, actorId: actor.userId, action: `PURCHASE_${document.documentType}_POSTED`, entityType: "PurchaseDocument", entityId: document.id,
      changes: inputJson({ voucherId: voucher.id, voucherNumber: voucher.voucherNumber, total: document.totalAmount.toString() }), ...requestInfo }, tx);
    return { document: updated, voucher, replayed: false };
  });
}

export async function cancelPurchaseDocument(actor: Actor, documentId: string, reversalDate: string, rawKey: string | null, reason: string, requestInfo: RequestInfo) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const bodyHash = digest({ documentId, reversalDate, reason });
  return withTransaction(async (tx) => {
    const prior = await tx.purchaseDocument.findUnique({ where: { companyId_cancelIdempotencyKey: { companyId: actor.companyId, cancelIdempotencyKey: key } } });
    if (prior) {
      if (prior.cancelRequestHash !== bodyHash) throw new ConflictError("Idempotency-Key was used for different purchase cancellation details");
      return { document: prior, replayed: true };
    }
    const document = await tx.purchaseDocument.findFirst({ where: { id: documentId, companyId: actor.companyId }, include: { lines: true } });
    if (!document) throw new NotFoundError("Purchase document not found in the current company");
    if (["CANCELLED", "REVERSED"].includes(document.status)) throw new ConflictError("This purchase document has already been cancelled or reversed");
    const children = await tx.purchaseDocument.findMany({ where: { companyId: actor.companyId, sourceDocumentId: document.id, status: { notIn: ["CANCELLED", "REVERSED"] } }, select: { id: true } });
    if (children.length) throw new ConflictError("Cancel downstream purchase documents before cancelling this source");
    let status: "CANCELLED" | "REVERSED" = "CANCELLED";
    if (document.status === "POSTED") {
      if (!document.voucherId) throw new Error("Posted purchase document is missing its accounting voucher");
      await reversePostedVoucher(actor, document.voucherId, reversalDate, `${rawKey}:reverse`, reason, requestInfo, tx);
      status = "REVERSED";
      for (const line of document.lines) {
        if (!line.sourceLineId) continue;
        const source = await tx.purchaseDocument.findFirst({ where: { id: document.sourceDocumentId ?? "", companyId: actor.companyId }, select: { documentType: true } });
        if (document.documentType === "RECEIPT_NOTE") await tx.purchaseDocumentLine.update({ where: { id: line.sourceLineId }, data: { receivedQuantity: { decrement: line.quantity } } });
        if (document.documentType === "PURCHASE_INVOICE") await tx.purchaseDocumentLine.update({ where: { id: line.sourceLineId }, data: source?.documentType === "PURCHASE_ORDER"
          ? { invoicedQuantity: { decrement: line.quantity }, receivedQuantity: { decrement: line.quantity } }
          : { invoicedQuantity: { decrement: line.quantity } } });
        if (document.documentType === "PURCHASE_INVOICE" && source?.documentType === "RECEIPT_NOTE") {
          const receiptLine = await tx.purchaseDocumentLine.findFirst({ where: { id: line.sourceLineId, companyId: actor.companyId }, select: { sourceLineId: true } });
          if (receiptLine?.sourceLineId) await tx.purchaseDocumentLine.update({ where: { id: receiptLine.sourceLineId }, data: { invoicedQuantity: { decrement: line.quantity } } });
        }
      }
      if (document.sourceDocumentId) {
        const source = await tx.purchaseDocument.findFirst({ where: { id: document.sourceDocumentId, companyId: actor.companyId }, select: { documentType: true, sourceDocumentId: true } });
        await updateSourceProgress(tx, actor.companyId, source?.documentType === "RECEIPT_NOTE" ? source.sourceDocumentId ?? document.sourceDocumentId : document.sourceDocumentId);
      }
    }
    const updated = await tx.purchaseDocument.update({ where: { id: document.id }, data: { status, cancelledAt: new Date(), cancelIdempotencyKey: key, cancelRequestHash: bodyHash } });
    await appendEvent(tx, actor, document.id, status === "REVERSED" ? "REVERSED" : "CANCELLED", `${key}:cancelled`, inputJson({ previousStatus: document.status, status, reason, reversalDate }));
    await writeAuditLog({ companyId: actor.companyId, actorId: actor.userId, action: `PURCHASE_DOCUMENT_${status}`, entityType: "PurchaseDocument", entityId: document.id,
      changes: inputJson({ previousStatus: document.status, status, reason, reversalDate }), ...requestInfo }, tx);
    return { document: updated, replayed: false };
  });
}
