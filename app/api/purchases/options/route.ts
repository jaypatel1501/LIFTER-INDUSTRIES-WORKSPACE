import { errorResponse, successResponse } from "@/lib/api-response";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const context = await requirePermission("purchases", "read");
    await enforceRateLimit(rateLimitKey("purchases-options", context.userId), 60, 60_000);
    const [suppliers, items, warehouses, paymentLedgers, costCentres] = await Promise.all([
      prisma.party.findMany({ where: { companyId: context.companyId, type: "SUPPLIER", isActive: true }, orderBy: { name: "asc" },
        select: { id: true, name: true, stateCode: true, creditPeriodDays: true, addressLine1: true, city: true, state: true, postalCode: true } }),
      prisma.stockItem.findMany({ where: { companyId: context.companyId, isActive: true }, orderBy: { name: "asc" },
        select: { id: true, name: true, hsnSac: true, gstRate: true, purchaseRate: true, batchTracked: true, baseUnit: { select: { symbol: true } } } }),
      prisma.warehouse.findMany({ where: { companyId: context.companyId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.ledger.findMany({ where: { companyId: context.companyId, isActive: true, type: { in: ["CASH", "BANK"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
      prisma.costCentre.findMany({ where: { companyId: context.companyId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    return successResponse({ suppliers, items: items.map((item) => ({ ...item, gstRate: item.gstRate.toString(), purchaseRate: item.purchaseRate.toString() })), warehouses, paymentLedgers, costCentres });
  } catch (error) {
    return errorResponse(error);
  }
}
