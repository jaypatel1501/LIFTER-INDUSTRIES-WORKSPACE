import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { ConflictError } from "@/lib/errors";
import { createStockItemWithOpening } from "@/lib/inventory/stock-item-service";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readJson, requestIp, requestUserAgent } from "@/lib/request";
import { inventoryListQuerySchema, stockItemCreateSchema } from "@/lib/validation/inventory";

export async function GET(request: Request) {
  try {
    const context = await requirePermission("inventory", "read");
    await enforceRateLimit(rateLimitKey("stock-item-read", context.userId), 120, 60_000);
    const url = new URL(request.url);
    const query = inventoryListQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      groupId: url.searchParams.get("groupId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      batchTracked: url.searchParams.get("batchTracked") ?? undefined,
    });
    const where: Prisma.StockItemWhereInput = {
      companyId: context.companyId,
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.status ? { isActive: query.status === "ACTIVE" } : {}),
      ...(query.batchTracked !== undefined ? { batchTracked: query.batchTracked } : {}),
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { code: { contains: query.search, mode: "insensitive" } },
          { barcode: { contains: query.search, mode: "insensitive" } },
          { hsnSac: { contains: query.search, mode: "insensitive" } },
        ],
      } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.stockItem.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          group: { select: { id: true, name: true, code: true } },
          baseUnit: { select: { id: true, name: true, symbol: true, precision: true } },
          _count: { select: { balances: true, movements: true } },
        },
      }),
      prisma.stockItem.count({ where }),
    ]);
    const balances = items.length
      ? await prisma.stockBalance.groupBy({
          by: ["itemId"],
          where: { companyId: context.companyId, itemId: { in: items.map(({ id }) => id) } },
          _sum: { quantity: true, value: true },
        })
      : [];
    const byItem = new Map(balances.map((balance) => [balance.itemId, balance._sum]));
    return successResponse({
      items: items.map((item) => {
        const balance = byItem.get(item.id);
        return {
          ...item,
          gstRate: item.gstRate.toString(),
          purchaseRate: item.purchaseRate.toString(),
          salesRate: item.salesRate.toString(),
          mrp: item.mrp?.toString() ?? null,
          reorderLevel: item.reorderLevel.toString(),
          minimumLevel: item.minimumLevel.toString(),
          maximumLevel: item.maximumLevel?.toString() ?? null,
          onHand: balance?.quantity?.toString() ?? "0",
          stockValue: balance?.value?.toString() ?? "0",
        };
      }),
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
    const context = await requirePermission("inventory", "create");
    await enforceRateLimit(rateLimitKey("stock-item-write", context.userId), 30, 60_000);
    const input = stockItemCreateSchema.parse(await readJson(request));
    const result = await createStockItemWithOpening(
      context,
      input,
      request.headers.get("Idempotency-Key"),
      {
        ipAddress: requestIp(request),
        ...(requestUserAgent(request) ? { userAgent: requestUserAgent(request) } : {}),
      },
    );
    return successResponse({
      item: {
        ...result.item,
        gstRate: result.item.gstRate.toString(),
        purchaseRate: result.item.purchaseRate.toString(),
        salesRate: result.item.salesRate.toString(),
        mrp: result.item.mrp?.toString() ?? null,
        reorderLevel: result.item.reorderLevel.toString(),
        minimumLevel: result.item.minimumLevel.toString(),
        maximumLevel: result.item.maximumLevel?.toString() ?? null,
        balances: result.item.balances.map((balance) => ({
          ...balance,
          quantity: balance.quantity.toString(),
          value: balance.value.toString(),
        })),
      },
      replayed: result.replayed,
    }, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return errorResponse(new ConflictError("An item with this name, code, barcode, or idempotency key already exists"));
    }
    return errorResponse(error);
  }
}
