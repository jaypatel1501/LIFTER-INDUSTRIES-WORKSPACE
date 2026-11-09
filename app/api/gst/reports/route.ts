import { GSTReconciliationLineStatus, Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { getGSTPeriodBounds, gstReportQuerySchema } from "@/lib/validation/gst";

const money = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(2);
const MAX_GST_EXPORT_ROWS = 10_000;
const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" :
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

function csvResponse(filename: string, rows: Record<string, unknown>[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const csv = [columns.map(csvCell).join(","), ...rows.map((row) =>
    columns.map((column) => csvCell(row[column])).join(","),
  )].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(request: Request) {
  try {
    const context = await requirePermission("company", "read");
    await enforceRateLimit(rateLimitKey("gst-report-read", context.userId), 60, 60_000);
    const url = new URL(request.url);
    const query = gstReportQuerySchema.parse({
      periodKey: url.searchParams.get("periodKey"),
      report: url.searchParams.get("report"),
      format: url.searchParams.get("format") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
    });
    const { start, end } = getGSTPeriodBounds(query.periodKey);
    const skip = query.format === "csv" ? 0 : (query.page - 1) * query.pageSize;
    const take = query.format === "csv" ? MAX_GST_EXPORT_ROWS + 1 : query.pageSize;
    let rows: Record<string, unknown>[] = [];
    let data: Record<string, unknown>;
    let creditDebitNotes: Record<string, unknown>[] = [];

    if (query.report === "SALES_REGISTER" || query.report === "GSTR1") {
      const where = {
        companyId: context.companyId,
        documentType: "SALES_INVOICE" as const,
        status: "POSTED" as const,
        documentDate: { gte: start, lt: end },
        ...(query.search ? {
          OR: [
            { documentNumber: { contains: query.search, mode: "insensitive" as const } },
            { party: { name: { contains: query.search, mode: "insensitive" as const } } },
          ],
        } : {}),
      };
      const [documents, total, registration, adjustments] = await Promise.all([
        prisma.salesDocument.findMany({
          where,
          orderBy: [{ documentDate: "asc" }, { documentNumber: "asc" }],
          skip,
          take,
          include: { party: true, lines: { orderBy: { lineNumber: "asc" } } },
        }),
        prisma.salesDocument.count({ where }),
        prisma.gSTRegistration.findUnique({ where: { companyId: context.companyId }, select: { gstin: true } }),
        query.report === "GSTR1" ? prisma.gSTAdjustment.findMany({
          where: {
            companyId: context.companyId,
            periodKey: query.periodKey,
            side: "SALES",
            ...(query.search ? {
              OR: [
                { noteNumber: { contains: query.search, mode: "insensitive" as const } },
                { counterpartyGstin: { contains: query.search, mode: "insensitive" as const } },
              ],
            } : {}),
          },
          orderBy: [{ noteDate: "asc" }, { noteNumber: "asc" }],
          take: MAX_GST_EXPORT_ROWS + 1,
        }) : Promise.resolve([]),
      ]);
      rows = documents.map((document) => ({
        documentNumber: document.documentNumber,
        documentDate: document.documentDate.toISOString().slice(0, 10),
        customer: document.party.name,
        customerGstin: document.party.gstin ?? "",
        placeOfSupply: document.party.stateCode ?? "",
        taxableAmount: money(document.taxableAmount),
        cgstAmount: money(document.cgstAmount),
        sgstAmount: money(document.sgstAmount),
        utgstAmount: money(document.utgstAmount),
        igstAmount: money(document.igstAmount),
        cessAmount: money(document.cessAmount),
        totalAmount: money(document.totalAmount),
        reverseCharge: document.lines.some((line) => line.reverseCharge),
        items: document.lines.map((line) => ({
          hsnSac: line.hsnSac ?? "",
          description: line.description,
          quantity: line.quantity.toString(),
          taxableAmount: money(line.taxableAmount),
          gstRate: line.gstRate.toString(),
          cessRate: line.cessRate.toString(),
        })),
      }));
      if (query.report === "SALES_REGISTER") {
        data = { rows, total, page: query.page, pageSize: query.pageSize, periodKey: query.periodKey };
      } else {
        creditDebitNotes = adjustments.map((adjustment) => ({
          noteNumber: adjustment.noteNumber,
          noteDate: adjustment.noteDate.toISOString().slice(0, 10),
          noteType: adjustment.adjustmentType,
          counterpartyGstin: adjustment.counterpartyGstin,
          taxableAmount: money(adjustment.taxableAmount),
          cgstAmount: money(adjustment.cgstAmount),
          sgstAmount: money(adjustment.sgstAmount),
          utgstAmount: money(adjustment.utgstAmount),
          igstAmount: money(adjustment.igstAmount),
          cessAmount: money(adjustment.cessAmount),
        }));
        data = {
          gstin: registration?.gstin ?? null,
          returnType: "GSTR1",
          periodKey: query.periodKey,
          generatedAt: new Date().toISOString(),
          invoices: rows,
          creditDebitNotes,
          page: query.page,
          pageSize: query.pageSize,
          total,
        };
      }
    } else if (query.report === "PURCHASE_REGISTER") {
      const where = {
        companyId: context.companyId,
        documentType: "PURCHASE_INVOICE" as const,
        status: "POSTED" as const,
        supplierInvoiceDate: { gte: start, lt: end },
        ...(query.search ? {
          OR: [
            { supplierInvoiceNumber: { contains: query.search, mode: "insensitive" as const } },
            { party: { name: { contains: query.search, mode: "insensitive" as const } } },
          ],
        } : {}),
      };
      const [documents, total] = await Promise.all([
        prisma.purchaseDocument.findMany({
          where,
          orderBy: [{ supplierInvoiceDate: "asc" }, { documentNumber: "asc" }],
          skip,
          take,
          include: { party: true, lines: { orderBy: { lineNumber: "asc" } } },
        }),
        prisma.purchaseDocument.count({ where }),
      ]);
      rows = documents.map((document) => ({
        documentNumber: document.documentNumber,
        supplierInvoiceNumber: document.supplierInvoiceNumber ?? "",
        supplierInvoiceDate: document.supplierInvoiceDate?.toISOString().slice(0, 10) ?? "",
        documentDate: document.supplierInvoiceDate?.toISOString().slice(0, 10) ?? "",
        supplier: document.party.name,
        supplierGstin: document.party.gstin ?? "",
        placeOfSupply: document.party.stateCode ?? "",
        taxableAmount: money(document.taxableAmount),
        cgstAmount: money(document.cgstAmount),
        sgstAmount: money(document.sgstAmount),
        utgstAmount: money(document.utgstAmount),
        igstAmount: money(document.igstAmount),
        cessAmount: money(document.cessAmount),
        totalAmount: money(document.totalAmount),
        reverseCharge: document.lines.some((line) => line.reverseCharge),
      }));
      data = { rows, total, page: query.page, pageSize: query.pageSize, periodKey: query.periodKey };
    } else if (query.report === "GSTR3B") {
      const [sales, purchases, purchaseReturns, adjustments, rcmLines] = await Promise.all([
        prisma.salesDocument.aggregate({
          where: { companyId: context.companyId, documentType: "SALES_INVOICE", status: "POSTED", documentDate: { gte: start, lt: end } },
          _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, utgstAmount: true, igstAmount: true, cessAmount: true },
        }),
        prisma.purchaseDocument.aggregate({
          where: { companyId: context.companyId, documentType: "PURCHASE_INVOICE", status: "POSTED", supplierInvoiceDate: { gte: start, lt: end } },
          _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, utgstAmount: true, igstAmount: true, cessAmount: true },
        }),
        prisma.purchaseDocument.aggregate({
          where: { companyId: context.companyId, documentType: "PURCHASE_RETURN", status: "POSTED", documentDate: { gte: start, lt: end } },
          _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, utgstAmount: true, igstAmount: true, cessAmount: true },
        }),
        prisma.gSTAdjustment.findMany({ where: { companyId: context.companyId, periodKey: query.periodKey } }),
        prisma.purchaseDocumentLine.findMany({
          where: {
            companyId: context.companyId,
            reverseCharge: true,
            document: {
              status: "POSTED",
              OR: [
                { documentType: "PURCHASE_INVOICE", supplierInvoiceDate: { gte: start, lt: end } },
                { documentType: "PURCHASE_RETURN", documentDate: { gte: start, lt: end } },
              ],
            },
          },
          select: {
            taxableAmount: true, cgstAmount: true, sgstAmount: true, utgstAmount: true, igstAmount: true, cessAmount: true,
            document: { select: { documentType: true } },
          },
        }),
      ]);
      const sumAdjustments = (side: "SALES" | "PURCHASE", field: "taxableAmount" | "cgstAmount" | "sgstAmount" | "utgstAmount" | "igstAmount" | "cessAmount") =>
        adjustments.filter((item) => item.side === side).reduce((sum, item) => {
          const sign = item.adjustmentType === "CREDIT_NOTE" ? -1 : 1;
          return sum.plus(item[field].mul(sign));
        }, new Prisma.Decimal(0));
      const components = ["cgstAmount", "sgstAmount", "utgstAmount", "igstAmount", "cessAmount"] as const;
      const sumReverseCharge = (field: "taxableAmount" | typeof components[number]) =>
        rcmLines.reduce((sum, line) => sum.plus(
          line[field].mul(line.document.documentType === "PURCHASE_RETURN" ? -1 : 1),
        ), new Prisma.Decimal(0));
      const salesTax = Object.fromEntries(components.map((field) => [
        field, money((sales._sum[field] ?? new Prisma.Decimal(0)).plus(sumAdjustments("SALES", field))),
      ]));
      const itcTax = Object.fromEntries(components.map((field) => [
        field, money(
          (purchases._sum[field] ?? new Prisma.Decimal(0))
            .minus(purchaseReturns._sum[field] ?? new Prisma.Decimal(0))
            .plus(sumAdjustments("PURCHASE", field))
            .plus(sumReverseCharge(field)),
        ),
      ]));
      const reverseChargeTax = Object.fromEntries(components.map((field) => [
        field, money(sumReverseCharge(field)),
      ]));
      rows = [{
        outwardTaxableValue: money((sales._sum.taxableAmount ?? new Prisma.Decimal(0)).plus(sumAdjustments("SALES", "taxableAmount"))),
        inwardTaxableValue: money(
          (purchases._sum.taxableAmount ?? new Prisma.Decimal(0))
            .minus(purchaseReturns._sum.taxableAmount ?? new Prisma.Decimal(0))
            .plus(sumAdjustments("PURCHASE", "taxableAmount")),
        ),
        outputTax: salesTax,
        eligibleInputTaxCredit: itcTax,
        reverseChargeTaxLiability: reverseChargeTax,
        reverseChargePurchases: {
          taxableAmount: money(sumReverseCharge("taxableAmount")),
          ...Object.fromEntries(components.map((field) => [
            field, money(sumReverseCharge(field)),
          ])),
        },
      }];
      data = { returnType: "GSTR3B", periodKey: query.periodKey, generatedAt: new Date().toISOString(), summary: rows[0] };
    } else if (query.report === "GST_LEDGER") {
      const where = { companyId: context.companyId, transactionDate: { gte: start, lt: end } };
      const [transactions, total] = await Promise.all([
        prisma.taxTransaction.findMany({
          where,
          orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          skip,
          take,
          include: { ledger: { select: { name: true, code: true } }, voucher: { select: { voucherNumber: true, type: true } } },
        }),
        prisma.taxTransaction.count({ where }),
      ]);
      rows = transactions.map((transaction) => ({
        date: transaction.transactionDate.toISOString().slice(0, 10),
        voucherNumber: transaction.voucher.voucherNumber,
        voucherType: transaction.voucher.type,
        ledger: transaction.ledger.name,
        ledgerCode: transaction.ledger.code,
        taxType: transaction.taxType,
        taxableAmount: money(transaction.taxableAmount),
        rate: transaction.rate.toString(),
        taxAmount: money(transaction.taxAmount),
        isReversal: transaction.isReversal,
      }));
      data = { rows, total, page: query.page, pageSize: query.pageSize, periodKey: query.periodKey };
    } else {
      const where = {
        companyId: context.companyId,
        upload: { periodKey: query.periodKey },
        status: { in: [GSTReconciliationLineStatus.MISMATCH, GSTReconciliationLineStatus.MISSING_IN_BOOKS] },
        ...(query.search ? { invoiceNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
      };
      const [mismatches, total] = await Promise.all([
        prisma.gSTReconciliationLine.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { rowNumber: "asc" }],
          skip,
          take,
        }),
        prisma.gSTReconciliationLine.count({ where }),
      ]);
      rows = mismatches.map((line) => ({
        supplierGstin: line.supplierGstin ?? "",
        invoiceNumber: line.invoiceNumber,
        invoiceDate: line.invoiceDate?.toISOString().slice(0, 10) ?? "",
        taxableAmount: money(line.taxableAmount),
        cgstAmount: money(line.cgstAmount),
        sgstAmount: money(line.sgstAmount),
        utgstAmount: money(line.utgstAmount),
        igstAmount: money(line.igstAmount),
        cessAmount: money(line.cessAmount),
        status: line.status,
        mismatchDetails: line.mismatchDetails,
      }));
      data = { rows, total, page: query.page, pageSize: query.pageSize, periodKey: query.periodKey };
    }

    if (query.report === "GSTR1" && creditDebitNotes.length > MAX_GST_EXPORT_ROWS) {
      throw new ValidationError(`GSTR-1 datasets are limited to ${MAX_GST_EXPORT_ROWS.toLocaleString()} credit/debit notes per request`);
    }

    if (query.format === "csv") {
      const reportTotal = typeof data.total === "number" ? data.total : rows.length;
      if (reportTotal > MAX_GST_EXPORT_ROWS || creditDebitNotes.length > MAX_GST_EXPORT_ROWS ||
        (query.report === "GSTR1" && reportTotal + creditDebitNotes.length > MAX_GST_EXPORT_ROWS)) {
        throw new ValidationError(`CSV exports are limited to ${MAX_GST_EXPORT_ROWS.toLocaleString()} rows; narrow the period or search filter`);
      }
      const exportRows = query.report === "GSTR1"
        ? [
          ...rows.map((row) => ({ recordType: "B2B_INVOICE", ...row })),
          ...creditDebitNotes.map((note) => ({ recordType: "CREDIT_DEBIT_NOTE", ...note })),
        ]
        : rows;
      return csvResponse(`${query.report.toLowerCase()}-${query.periodKey}.csv`, exportRows);
    }
    return successResponse({ report: query.report, ...data });
  } catch (error) {
    return errorResponse(error);
  }
}
