import { errorResponse, successResponse } from "@/lib/api-response";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const context = await requirePermission("vouchers", "read");
    const [ledgers, costCentres, financialYears, numberSeries, stockItems, warehouses] = await Promise.all([
      prisma.ledger.findMany({
        where: { companyId: context.companyId, isActive: true },
        select: { id: true, name: true, code: true, type: true, costCentreEnabled: true },
        orderBy: { name: "asc" },
      }),
      prisma.costCentre.findMany({
        where: { companyId: context.companyId, isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      }),
      prisma.financialYear.findMany({
        where: { companyId: context.companyId },
        select: { id: true, name: true, startDate: true, endDate: true, booksBeginningDate: true, status: true },
        orderBy: { startDate: "desc" },
      }),
      prisma.voucherNumberSeries.findMany({
        where: { companyId: context.companyId },
        select: { id: true, voucherType: true, financialYearId: true, prefix: true, suffix: true, nextNumber: true, padding: true, requiresApproval: true, isActive: true },
        orderBy: [{ voucherType: "asc" }, { periodKey: "asc" }],
      }),
      prisma.stockItem.findMany({
        where: { companyId: context.companyId, isActive: true },
        select: { id: true, name: true, code: true, batchTracked: true, baseUnit: { select: { symbol: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.warehouse.findMany({
        where: { companyId: context.companyId, isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return successResponse({
      ledgers,
      costCentres,
      financialYears: financialYears.map((year) => ({
        ...year,
        startDate: year.startDate.toISOString().slice(0, 10),
        endDate: year.endDate.toISOString().slice(0, 10),
        booksBeginningDate: year.booksBeginningDate.toISOString().slice(0, 10),
      })),
      numberSeries,
      stockItems,
      warehouses,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
