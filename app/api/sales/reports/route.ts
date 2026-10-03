import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ValidationError } from "@/lib/errors";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const querySchema = z.object({
  view: z.enum(["register", "customers", "profitability"]).default("register"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().trim().max(120).optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("sales-reports", "read");
    await enforceRateLimit(rateLimitKey("sales-report", context.userId), 60, 60_000);
    const params = new URL(request.url).searchParams;
    const query = querySchema.parse({
      view: params.get("view") ?? undefined,
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      search: params.get("search") ?? undefined,
    });
    if (query.from && query.to && query.from > query.to) {
      throw new ValidationError("From date must be on or before the to date");
    }
    const where: Prisma.SalesDocumentWhereInput = {
      companyId: context.companyId,
      documentType: "SALES_INVOICE",
      status: "POSTED",
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
    if (query.view === "customers") {
      const summaries = await prisma.salesDocument.groupBy({
        by: ["partyId"],
        where,
        _sum: { totalAmount: true, taxableAmount: true, costOfGoodsSold: true },
        _count: { _all: true },
        orderBy: { _sum: { totalAmount: "desc" } },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const parties = summaries.length
        ? await prisma.party.findMany({
            where: { companyId: context.companyId, id: { in: summaries.map((row) => row.partyId) } },
            select: { id: true, name: true },
          })
        : [];
      const names = new Map(parties.map((party) => [party.id, party.name]));
      const total = await prisma.salesDocument.findMany({ where, distinct: ["partyId"], select: { partyId: true } });
      return successResponse({
        customers: summaries.map((row) => ({
          partyId: row.partyId,
          name: names.get(row.partyId) ?? "",
          invoiceCount: row._count._all,
          sales: row._sum.totalAmount?.toString() ?? "0",
          taxableSales: row._sum.taxableAmount?.toString() ?? "0",
          costOfGoodsSold: row._sum.costOfGoodsSold?.toString() ?? "0",
          grossProfit: (row._sum.taxableAmount ?? new Prisma.Decimal(0)).minus(row._sum.costOfGoodsSold ?? new Prisma.Decimal(0)).toString(),
        })),
        total: total.length,
        page: query.page,
        pageSize: query.pageSize,
      });
    }
    const aggregate = await prisma.salesDocument.aggregate({
      where,
      _sum: { totalAmount: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, utgstAmount: true, igstAmount: true, costOfGoodsSold: true },
      _count: { _all: true },
    });
    const documents = await prisma.salesDocument.findMany({
      where,
      orderBy: [{ documentDate: "desc" }, { documentNumber: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, documentNumber: true, documentDate: true, totalAmount: true, taxableAmount: true,
        cgstAmount: true, sgstAmount: true, utgstAmount: true, igstAmount: true,
        costOfGoodsSold: true, status: true, party: { select: { id: true, name: true } },
      },
    });
    return successResponse({
      documents: documents.map((doc) => ({
        ...doc,
        totalAmount: doc.totalAmount.toString(),
        taxableAmount: doc.taxableAmount.toString(),
        cgstAmount: doc.cgstAmount.toString(),
        sgstAmount: doc.sgstAmount.toString(),
        utgstAmount: doc.utgstAmount.toString(),
        igstAmount: doc.igstAmount.toString(),
        costOfGoodsSold: doc.costOfGoodsSold.toString(),
        grossProfit: doc.taxableAmount.minus(doc.costOfGoodsSold).toString(),
      })),
      summary: {
        count: aggregate._count._all,
        sales: aggregate._sum.totalAmount?.toString() ?? "0",
        taxableSales: aggregate._sum.taxableAmount?.toString() ?? "0",
        tax: (aggregate._sum.cgstAmount ?? new Prisma.Decimal(0))
          .plus(aggregate._sum.sgstAmount ?? new Prisma.Decimal(0))
          .plus(aggregate._sum.utgstAmount ?? new Prisma.Decimal(0))
          .plus(aggregate._sum.igstAmount ?? new Prisma.Decimal(0)).toString(),
        costOfGoodsSold: aggregate._sum.costOfGoodsSold?.toString() ?? "0",
        grossProfit: (aggregate._sum.taxableAmount ?? new Prisma.Decimal(0))
          .minus(aggregate._sum.costOfGoodsSold ?? new Prisma.Decimal(0)).toString(),
      },
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
