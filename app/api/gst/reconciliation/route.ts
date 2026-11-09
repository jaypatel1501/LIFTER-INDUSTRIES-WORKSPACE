import { createHash } from "node:crypto";
import { del, put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError, ValidationError, AppError } from "@/lib/errors";
import { hashIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/permissions";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requestIp, requestUserAgent } from "@/lib/request";
import { withTransaction } from "@/lib/transactions";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { gstPeriodBounds } from "@/lib/gst/engine";
import { gstinSchema } from "@/lib/gst/engine";

const rowSchema = z.object({
  supplierGstin: gstinSchema,
  invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.string().trim().optional().default(""),
  taxableAmount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
  cgstAmount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).default("0"),
  sgstAmount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).default("0"),
  utgstAmount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).default("0"),
  igstAmount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).default("0"),
  cessAmount: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).default("0"),
});
type ReconciliationRow = z.infer<typeof rowSchema>;

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(value.trim());
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new ValidationError("The uploaded CSV contains an unterminated quoted field");
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new ValidationError("The uploaded file must include a header and at least one invoice row");
  const headers = rows[0]!.map((header) => header.replace(/^\uFEFF/, "").toLowerCase().replace(/[\s_-]/g, ""));
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function normalizeRow(value: Record<string, unknown>) {
  const normalized = Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.toLowerCase().replace(/[\s_-]/g, ""),
    item === undefined || item === null ? "" : String(item),
  ]));
  return rowSchema.parse({
    supplierGstin: normalized.suppliergstin ?? normalized.gstin ?? "",
    invoiceNumber: normalized.invoicenumber ?? normalized.invoiceno ?? normalized.documentnumber ?? "",
    invoiceDate: normalized.invoicedate ?? "",
    taxableAmount: normalized.taxableamount ?? normalized.taxablevalue ?? "",
    cgstAmount: normalized.cgstamount ?? normalized.cgst ?? "0",
    sgstAmount: normalized.sgstamount ?? normalized.sgst ?? "0",
    utgstAmount: normalized.utgstamount ?? normalized.utgst ?? "0",
    igstAmount: normalized.igstamount ?? normalized.igst ?? "0",
    cessAmount: normalized.cessamount ?? normalized.cess ?? "0",
  });
}

function moneyEquals(left: Prisma.Decimal, right: string) {
  return left.minus(right).abs().lessThanOrEqualTo("0.01");
}

export async function GET(request: Request) {
  try {
    const context = await requirePermission("company", "read");
    const periodKey = new URL(request.url).searchParams.get("periodKey");
    const where = {
      companyId: context.companyId,
      ...(periodKey ? { periodKey } : {}),
    };
    const uploads = await prisma.gSTReconciliationUpload.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, periodKey: true, fileName: true, status: true, rowCount: true,
        matchedCount: true, mismatchCount: true, missingCount: true, createdAt: true,
      },
    });
    return successResponse({ uploads });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let blobUrl: string | undefined;
  try {
    const context = await requirePermission("company", "update");
    await enforceRateLimit(rateLimitKey("gst-reconciliation-upload", context.userId), 5, 60 * 60_000);
    if (!env.BLOB_READ_WRITE_TOKEN) throw new AppError("Object storage is not configured", 503, "STORAGE_UNAVAILABLE");
    const form = await request.formData();
    const file = form.get("file");
    const periodKey = String(form.get("periodKey") ?? "");
    gstPeriodBounds(periodKey);
    if (!(file instanceof File)) throw new ValidationError("A CSV or JSON file is required");
    if (file.size < 1 || file.size > 10 * 1024 * 1024) {
      throw new ValidationError("Reconciliation file must be between 1 byte and 10 MB");
    }
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "csv" && extension !== "json") {
      throw new ValidationError("Only normalized CSV and JSON reconciliation files are supported");
    }
    const rawKey = request.headers.get("Idempotency-Key");
    if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
    const idempotencyKey = hashIdempotencyKey(rawKey);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(fileBytes).digest("hex");
    const requestHash = createHash("sha256").update(`${periodKey}:${fileHash}`).digest("hex");
    const existing = await prisma.gSTReconciliationUpload.findUnique({
      where: { companyId_idempotencyKey: { companyId: context.companyId, idempotencyKey } },
      select: { id: true, requestHash: true, status: true },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictError("Idempotency-Key was used for a different reconciliation upload");
      return successResponse({ uploadId: existing.id, status: existing.status, replayed: true });
    }

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(fileBytes);
    let rows: ReconciliationRow[];
    if (extension === "csv") {
      rows = parseCsv(decoded).map((row) => normalizeRow(row));
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoded);
      } catch {
        throw new ValidationError("The uploaded JSON is not valid");
      }
      const sourceRows = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "rows" in parsed && Array.isArray(parsed.rows)
          ? parsed.rows
          : null;
      if (!sourceRows) throw new ValidationError("JSON upload must be an array of invoice rows or an object containing a rows array");
      rows = sourceRows.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new ValidationError("Each reconciliation row must be an object");
        return normalizeRow(row as Record<string, unknown>);
      });
    }
    if (!rows.length || rows.length > 10_000) {
      throw new ValidationError("Upload must contain between 1 and 10,000 invoice rows");
    }
    for (const [index, row] of rows.entries()) {
      if (row.invoiceDate && !z.iso.date().safeParse(row.invoiceDate).success) {
        throw new ValidationError(`Invoice date on row ${index + 2} must use YYYY-MM-DD`);
      }
      if (row.supplierGstin) gstinSchema.parse(row.supplierGstin);
    }

    const existingInvoices = await prisma.purchaseDocument.findMany({
      where: {
        companyId: context.companyId,
        documentType: "PURCHASE_INVOICE",
        status: "POSTED",
        supplierInvoiceNumber: { in: rows.map((row) => row.invoiceNumber) },
      },
      include: { party: { select: { gstin: true } } },
    });
    const invoiceMap = new Map<string, typeof existingInvoices>();
    for (const invoice of existingInvoices) {
      const invoiceNumber = invoice.supplierInvoiceNumber?.trim().toUpperCase() ?? "";
      invoiceMap.set(invoiceNumber, [...(invoiceMap.get(invoiceNumber) ?? []), invoice]);
    }
    const compared = rows.map((row, index) => {
      const candidates = invoiceMap.get(row.invoiceNumber.trim().toUpperCase()) ?? [];
      const gstinMatches = candidates.filter((candidate) =>
        candidate.party.gstin?.toUpperCase() === row.supplierGstin.toUpperCase(),
      );
      const invoice = gstinMatches.length === 1 ? gstinMatches[0] :
        candidates.length === 1 ? candidates[0] : null;
      if (!invoice) {
        return {
          row,
          rowNumber: index + 2,
          invoice: null,
          status: candidates.length > 1 ? "MISMATCH" as const : "MISSING_IN_BOOKS" as const,
          mismatchDetails: candidates.length > 1
            ? { invoiceIdentity: { books: `${candidates.length} possible invoices`, gstr2b: row.invoiceNumber } }
            : null,
        };
      }
      const differences: Record<string, { books: string; gstr2b: string }> = {};
      if (row.supplierGstin && invoice.party.gstin?.toUpperCase() !== row.supplierGstin.toUpperCase()) {
        differences.supplierGstin = { books: invoice.party.gstin ?? "", gstr2b: row.supplierGstin };
      }
      const bookInvoiceDate = invoice.supplierInvoiceDate?.toISOString().slice(0, 10) ?? "";
      if (row.invoiceDate && bookInvoiceDate !== row.invoiceDate) {
        differences.invoiceDate = { books: bookInvoiceDate, gstr2b: row.invoiceDate };
      }
      for (const [field, books] of [
        ["taxableAmount", invoice.taxableAmount],
        ["cgstAmount", invoice.cgstAmount],
        ["sgstAmount", invoice.sgstAmount],
        ["utgstAmount", invoice.utgstAmount],
        ["igstAmount", invoice.igstAmount],
        ["cessAmount", invoice.cessAmount],
      ] as const) {
        if (!moneyEquals(books, row[field])) differences[field] = { books: books.toFixed(2), gstr2b: row[field] };
      }
      return {
        row,
        rowNumber: index + 2,
        invoice,
        status: Object.keys(differences).length ? "MISMATCH" as const : "MATCHED" as const,
        mismatchDetails: Object.keys(differences).length ? differences : null,
      };
    });
    const pathname = `gst-reconciliation/${context.companyId}/${periodKey}/${idempotencyKey}.${extension}`;
    const blob = await put(pathname, Buffer.from(fileBytes), {
      access: "private",
      contentType: extension === "csv" ? "text/csv" : "application/json",
      token: env.BLOB_READ_WRITE_TOKEN,
    });
    blobUrl = blob.url;
    const upload = await withTransaction(async (tx) => {
      const created = await tx.gSTReconciliationUpload.create({
        data: {
          company: { connect: { id: context.companyId } },
          uploadedBy: { connect: { id: context.userId } },
          periodKey,
          fileName: file.name.slice(0, 240),
          contentType: blob.contentType,
          blobUrl: blob.url,
          status: "COMPLETED",
          rowCount: compared.length,
          matchedCount: compared.filter((entry) => entry.status === "MATCHED").length,
          mismatchCount: compared.filter((entry) => entry.status === "MISMATCH").length,
          missingCount: compared.filter((entry) => entry.status === "MISSING_IN_BOOKS").length,
          idempotencyKey,
          requestHash,
          rows: {
            create: compared.map(({ row, rowNumber, invoice, status, mismatchDetails }) => ({
              company: { connect: { id: context.companyId } },
              rowNumber,
              supplierGstin: row.supplierGstin || null,
              invoiceNumber: row.invoiceNumber,
              invoiceDate: row.invoiceDate ? new Date(`${row.invoiceDate}T00:00:00.000Z`) : null,
              taxableAmount: row.taxableAmount,
              cgstAmount: row.cgstAmount,
              sgstAmount: row.sgstAmount,
              utgstAmount: row.utgstAmount,
              igstAmount: row.igstAmount,
              cessAmount: row.cessAmount,
              status,
              bookDocumentId: invoice?.id ?? null,
              mismatchDetails: mismatchDetails ? mismatchDetails as Prisma.InputJsonValue : Prisma.DbNull,
            })),
          },
        },
      });
      await writeAuditLog({
        companyId: context.companyId,
        actorId: context.userId,
        action: "GST_2B_RECONCILIATION_UPLOADED",
        entityType: "GSTReconciliationUpload",
        entityId: created.id,
        changes: {
          periodKey,
          fileName: created.fileName,
          rowCount: created.rowCount,
          matchedCount: created.matchedCount,
          mismatchCount: created.mismatchCount,
          missingCount: created.missingCount,
        },
        ipAddress: requestIp(request),
        userAgent: requestUserAgent(request),
      }, tx);
      return created;
    });
    return successResponse({
      uploadId: upload.id,
      status: upload.status,
      rowCount: upload.rowCount,
      matchedCount: upload.matchedCount,
      mismatchCount: upload.mismatchCount,
      missingCount: upload.missingCount,
      replayed: false,
    }, 201);
  } catch (error) {
    if (blobUrl && env.BLOB_READ_WRITE_TOKEN) {
      try {
        await del(blobUrl, { token: env.BLOB_READ_WRITE_TOKEN });
      } catch (cleanupError) {
        console.error("Could not clean up an unlinked GST reconciliation blob", cleanupError instanceof Error ? cleanupError.name : "UnknownError");
      }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Reconciliation idempotency key already exists"));
    }
    return errorResponse(error);
  }
}
