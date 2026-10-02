import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { createSalesDraft } from "@/lib/sales/sales-service";
import { salesDocumentCreateSchema, salesListQuerySchema } from "@/lib/validation/sales";

export async function GET(request: Request) {
  try {
    const context = await requirePermission("sales", "read");
    await enforceRateLimit(rateLimitKey("sales-read", context.userId), 120, 60_000);
    const params = new URL(request.url).searchParams;
    const query = salesListQuerySchema.parse({
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
      search: params.get("search") ?? undefined,
      documentType: params.get("documentType") ?? undefined,
      status: params.get("status") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    const where: Prisma.SalesDocumentWhereInput = {
      companyId: context.companyId,
      ...(query.documentType ? { documentType: query.documentType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { documentDate: {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
      } } : {}),
      ...(query.search ? {
        OR: [
          { documentNumber: { contains: query.search, mode: "insensitive" } },
          { party: { name: { contains: query.search, mode: "insensitive" } } },
        ],
      } : {}),
    };
    const [documents, total] = await Promise.all([
      prisma.salesDocument.findMany({
        where,
        orderBy: [{ documentDate: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true, documentNumber: true, documentType: true, status: true, documentDate: true,
          dueDate: true, totalAmount: true, party: { select: { id: true, name: true } },
          sourceDocument: { select: { id: true, documentNumber: true, documentType: true } },
          voucher: { select: { id: true, voucherNumber: true } },
        },
      }),
      prisma.salesDocument.count({ where }),
    ]);
    return successResponse({
      documents: documents.map((doc) => ({ ...doc, totalAmount: doc.totalAmount.toString() })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("sales", "create");
    await enforceRateLimit(rateLimitKey("sales-create", context.userId), 30, 60_000);
    const result = await createSalesDraft(
      context,
      salesDocumentCreateSchema.parse(await readJson(request)),
      request.headers.get("Idempotency-Key"),
      {
        ipAddress: requestIp(request),
        ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
      },
    );
    return successResponse({ document: result.document, replayed: result.replayed }, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("Sales document number or idempotency key already exists"));
    }
    return errorResponse(error);
  }
}
