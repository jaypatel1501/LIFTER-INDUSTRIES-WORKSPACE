import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { createPurchaseDraft } from "@/lib/purchases/purchase-service";
import { purchaseDocumentCreateSchema, purchaseListQuerySchema } from "@/lib/validation/purchases";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const context = await requirePermission("purchases", "read");
    await enforceRateLimit(rateLimitKey("purchases-read", context.userId), 120, 60_000);
    const params = new URL(request.url).searchParams;
    const query = purchaseListQuerySchema.parse({
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
      search: params.get("search") ?? undefined,
      documentType: params.get("documentType") ?? undefined,
      status: params.get("status") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    const where: Prisma.PurchaseDocumentWhereInput = {
      companyId: context.companyId,
      ...(query.documentType ? { documentType: query.documentType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { documentDate: {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      } } : {}),
      ...(query.search ? { OR: [
        { documentNumber: { contains: query.search, mode: "insensitive" } },
        { supplierInvoiceNumber: { contains: query.search, mode: "insensitive" } },
        { party: { name: { contains: query.search, mode: "insensitive" } } },
      ] } : {}),
    };
    const [documents, total] = await Promise.all([
      prisma.purchaseDocument.findMany({ where, orderBy: [{ documentDate: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, documentNumber: true, documentType: true, status: true, documentDate: true, dueDate: true,
          supplierInvoiceNumber: true, supplierInvoiceDate: true, totalAmount: true, party: { select: { id: true, name: true } },
          sourceDocument: { select: { id: true, documentNumber: true, documentType: true } },
          voucher: { select: { id: true, voucherNumber: true } } },
      }),
      prisma.purchaseDocument.count({ where }),
    ]);
    return successResponse({ documents: documents.map((doc) => ({ ...doc, totalAmount: doc.totalAmount.toString() })), total, page: query.page, pageSize: query.pageSize });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("purchases", "create");
    await enforceRateLimit(rateLimitKey("purchases-create", context.userId), 30, 60_000);
    const result = await createPurchaseDraft(context, purchaseDocumentCreateSchema.parse(await readJson(request)), request.headers.get("Idempotency-Key"), {
      ipAddress: requestIp(request), ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
    });
    return successResponse({ document: result.document, replayed: result.replayed }, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return errorResponse(new ConflictError("Purchase document number or supplier invoice reference already exists"));
    return errorResponse(error);
  }
}
