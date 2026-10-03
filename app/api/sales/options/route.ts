import { errorResponse, successResponse } from "@/lib/api-response";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const context = await requirePermission("sales", "read");
    await enforceRateLimit(rateLimitKey("sales-options", context.userId), 60, 60_000);
    const [customers, items, warehouses, paymentLedgers] = await Promise.all([
      prisma.party.findMany({
        where: { companyId: context.companyId, type: "CUSTOMER", isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, email: true, mobile: true, stateCode: true,
          addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, country: true,
        },
      }),
      prisma.stockItem.findMany({
        where: { companyId: context.companyId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, hsnSac: true, gstRate: true, salesRate: true, batchTracked: true, baseUnit: { select: { symbol: true } } },
      }),
      prisma.warehouse.findMany({
        where: { companyId: context.companyId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.ledger.findMany({
        where: { companyId: context.companyId, isActive: true, type: { in: ["CASH", "BANK"] } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true },
      }),
    ]);
    return successResponse({
      customers,
      items: items.map((item) => ({
        ...item,
        gstRate: item.gstRate.toString(),
        salesRate: item.salesRate.toString(),
      })),
      warehouses,
      paymentLedgers,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
