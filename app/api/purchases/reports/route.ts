import { Prisma } from "@prisma/client";
import { z } from "zod";
import { errorResponse, successResponse } from "@/lib/api-response";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const reportQuery = z.object({
  report: z.enum(["register", "analysis"]).default("register"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export async function GET(request: Request) {
  try {
    const context = await requirePermission("purchase-reports", "read");
    await enforceRateLimit(rateLimitKey("purchase-reports", context.userId), 60, 60_000);
    const params = new URL(request.url).searchParams;
    const query = reportQuery.parse({ report: params.get("report") ?? undefined, page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined, search: params.get("search") ?? undefined,
      from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
    const dateRange = query.from || query.to ? { documentDate: {
      ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
    } } : {};
    const baseWhere: Prisma.PurchaseDocumentWhereInput = { companyId: context.companyId, ...dateRange,
      ...(query.search ? { OR: [{ documentNumber: { contains: query.search, mode: "insensitive" } },
        { supplierInvoiceNumber: { contains: query.search, mode: "insensitive" } },
        { party: { name: { contains: query.search, mode: "insensitive" } } }] } : {}) };
    if (query.report === "register") {
      const where: Prisma.PurchaseDocumentWhereInput = { ...baseWhere, documentType: { in: ["PURCHASE_INVOICE", "PURCHASE_RETURN"] }, status: "POSTED" };
      const [documents, total, totals] = await Promise.all([
        prisma.purchaseDocument.findMany({ where, orderBy: [{ documentDate: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          select: { id: true, documentNumber: true, documentType: true, status: true, documentDate: true, supplierInvoiceNumber: true,
            supplierInvoiceDate: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, utgstAmount: true, igstAmount: true, totalAmount: true,
            party: { select: { id: true, name: true } }, voucher: { select: { voucherNumber: true } } } }),
        prisma.purchaseDocument.count({ where }),
        prisma.purchaseDocument.aggregate({ where, _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true, utgstAmount: true, igstAmount: true, totalAmount: true } }),
      ]);
      return successResponse({ report: "register", documents, total, page: query.page, pageSize: query.pageSize,
        totals: Object.fromEntries(Object.entries(totals._sum ?? {}).map(([key, value]) => [key, value?.toString() ?? "0"])) });
    }
    const invoiceWhere = { ...baseWhere, documentType: "PURCHASE_INVOICE" as const, status: "POSTED" as const };
    const returnWhere = { ...baseWhere, documentType: "PURCHASE_RETURN" as const, status: "POSTED" as const };
    const [invoiceSuppliers, returnSuppliers, invoiceItems, returnItems] = await Promise.all([
      prisma.purchaseDocument.groupBy({ by: ["partyId"], where: invoiceWhere, _sum: { totalAmount: true }, _count: { _all: true } }),
      prisma.purchaseDocument.groupBy({ by: ["partyId"], where: returnWhere, _sum: { totalAmount: true } }),
      prisma.purchaseDocumentLine.groupBy({ by: ["itemId"], where: { companyId: context.companyId, itemId: { not: null }, document: invoiceWhere }, _sum: { quantity: true, taxableAmount: true } }),
      prisma.purchaseDocumentLine.groupBy({ by: ["itemId"], where: { companyId: context.companyId, itemId: { not: null }, document: returnWhere }, _sum: { quantity: true, taxableAmount: true } }),
    ]);
    const partyIds = [...new Set([...invoiceSuppliers.map((row) => row.partyId), ...returnSuppliers.map((row) => row.partyId)])];
    const itemIds = [...new Set([...invoiceItems, ...returnItems].flatMap((row) => row.itemId ? [row.itemId] : []))];
    const [parties, items] = await Promise.all([
      prisma.party.findMany({ where: { companyId: context.companyId, id: { in: partyIds } }, select: { id: true, name: true } }),
      prisma.stockItem.findMany({ where: { companyId: context.companyId, id: { in: itemIds } }, select: { id: true, name: true, code: true } }),
    ]);
    const partyNames = new Map(parties.map((party) => [party.id, party.name]));
    const itemNames = new Map(items.map((item) => [item.id, item]));
    const purchasedByParty = new Map(invoiceSuppliers.map((row) => [row.partyId, row]));
    const returnedByParty = new Map(returnSuppliers.map((row) => [row.partyId, row._sum.totalAmount ?? new Prisma.Decimal(0)]));
    const purchasedByItem = new Map(invoiceItems.flatMap((row) => row.itemId ? [[row.itemId, row._sum] as const] : []));
    const returnedByItem = new Map(returnItems.flatMap((row) => row.itemId ? [[row.itemId, row._sum] as const] : []));
    return successResponse({ report: "analysis",
      suppliers: partyIds.map((id) => {
        const purchased = purchasedByParty.get(id);
        const purchaseAmount = purchased?._sum.totalAmount ?? new Prisma.Decimal(0);
        const returnAmount = returnedByParty.get(id) ?? new Prisma.Decimal(0);
        return { id, name: partyNames.get(id) ?? "Supplier", invoiceCount: purchased?._count._all ?? 0,
          purchaseAmount: purchaseAmount.toString(), returnAmount: returnAmount.toString(), netAmount: purchaseAmount.minus(returnAmount).toString() };
      })
        .sort((left, right) => Number(right.netAmount) - Number(left.netAmount)),
      items: itemIds.map((id) => {
        const purchased = purchasedByItem.get(id);
        const returned = returnedByItem.get(id);
        return { id, name: itemNames.get(id)?.name ?? "Stock item", code: itemNames.get(id)?.code ?? null,
          quantity: (purchased?.quantity ?? new Prisma.Decimal(0)).minus(returned?.quantity ?? 0).toString(),
          purchaseAmount: (purchased?.taxableAmount ?? new Prisma.Decimal(0)).minus(returned?.taxableAmount ?? 0).toString() };
      }).sort((left, right) => Number(right.purchaseAmount) - Number(left.purchaseAmount)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
