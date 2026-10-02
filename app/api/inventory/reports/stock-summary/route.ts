import { Prisma } from "@prisma/client";
import { errorResponse, successResponse } from "@/lib/api-response";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { inventoryListQuerySchema } from "@/lib/validation/inventory";

type SummaryRow = {
  id: string; name: string; code: string | null; hsnSac: string | null;
  gstRate: Prisma.Decimal; purchaseRate: Prisma.Decimal; salesRate: Prisma.Decimal;
  reorderLevel: Prisma.Decimal; minimumLevel: Prisma.Decimal; maximumLevel: Prisma.Decimal | null;
  groupName: string; unitSymbol: string; onHand: Prisma.Decimal; stockValue: Prisma.Decimal;
  total: bigint;
};

export async function GET(request: Request) {
  try {
    const context = await requirePermission("inventory", "read");
    await enforceRateLimit(rateLimitKey("inventory-stock-report", context.userId), 90, 60_000);
    const url = new URL(request.url);
    const query = inventoryListQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      groupId: url.searchParams.get("groupId") ?? undefined,
      warehouseId: url.searchParams.get("warehouseId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      lowStock: url.searchParams.get("lowStock") ?? undefined,
    });
    const rows = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      WITH stock AS (
        SELECT
          item."id", item."name", item."code", item."hsnSac", item."gstRate",
          item."purchaseRate", item."salesRate", item."reorderLevel",
          item."minimumLevel", item."maximumLevel", group_row."name" AS "groupName",
          unit."symbol" AS "unitSymbol",
          COALESCE(SUM(balance."quantity"), 0)::DECIMAL(18,6) AS "onHand",
          COALESCE(SUM(balance."value"), 0)::DECIMAL(18,4) AS "stockValue"
        FROM "StockItem" item
        JOIN "StockGroup" group_row ON group_row."companyId" = item."companyId" AND group_row."id" = item."groupId"
        JOIN "UnitOfMeasure" unit ON unit."companyId" = item."companyId" AND unit."id" = item."baseUnitId"
        LEFT JOIN "StockBalance" balance
          ON balance."companyId" = item."companyId" AND balance."itemId" = item."id"
          AND (${query.warehouseId ?? null}::TEXT IS NULL OR balance."warehouseId" = ${query.warehouseId ?? null})
        WHERE item."companyId" = ${context.companyId}
          AND (${query.status ?? null}::TEXT IS NULL OR item."isActive" = (${query.status ?? "ACTIVE"} = 'ACTIVE'))
          AND (${query.groupId ?? null}::TEXT IS NULL OR item."groupId" = ${query.groupId ?? null})
          AND (
            ${query.search ?? null}::TEXT IS NULL OR
            item."name" ILIKE '%' || ${query.search ?? ""} || '%' OR
            COALESCE(item."code", '') ILIKE '%' || ${query.search ?? ""} || '%' OR
            COALESCE(item."barcode", '') ILIKE '%' || ${query.search ?? ""} || '%' OR
            COALESCE(item."hsnSac", '') ILIKE '%' || ${query.search ?? ""} || '%'
          )
        GROUP BY item."id", group_row."name", unit."symbol"
        HAVING (
          NOT ${query.lowStock ?? false}::BOOLEAN OR
          (item."reorderLevel" > 0 AND COALESCE(SUM(balance."quantity"), 0) <= item."reorderLevel")
        )
      )
      SELECT stock.*, COUNT(*) OVER() AS "total"
      FROM stock
      ORDER BY stock."name" ASC, stock."id" ASC
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
    `);
    const total = Number(rows[0]?.total ?? 0);
    const [valuation, lowStockCount] = await Promise.all([
      prisma.stockBalance.aggregate({
        where: {
          companyId: context.companyId,
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          ...(query.groupId ? { item: { is: { groupId: query.groupId } } } : {}),
        },
        _sum: { quantity: true, value: true },
      }),
      prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS "count"
        FROM (
          SELECT item."id"
          FROM "StockItem" item
          LEFT JOIN "StockBalance" balance
            ON balance."companyId" = item."companyId" AND balance."itemId" = item."id"
            AND (${query.warehouseId ?? null}::TEXT IS NULL OR balance."warehouseId" = ${query.warehouseId ?? null})
          WHERE item."companyId" = ${context.companyId} AND item."isActive" = true AND item."reorderLevel" > 0
            AND (${query.groupId ?? null}::TEXT IS NULL OR item."groupId" = ${query.groupId ?? null})
            AND (
              ${query.search ?? null}::TEXT IS NULL OR
              item."name" ILIKE '%' || ${query.search ?? ""} || '%' OR
              COALESCE(item."code", '') ILIKE '%' || ${query.search ?? ""} || '%' OR
              COALESCE(item."barcode", '') ILIKE '%' || ${query.search ?? ""} || '%' OR
              COALESCE(item."hsnSac", '') ILIKE '%' || ${query.search ?? ""} || '%'
            )
          GROUP BY item."id", item."reorderLevel"
          HAVING COALESCE(SUM(balance."quantity"), 0) <= item."reorderLevel"
        ) low_stock
      `),
    ]);
    return successResponse({
      rows: rows.map((row) => ({
        id: row.id, name: row.name, code: row.code, hsnSac: row.hsnSac,
        gstRate: row.gstRate.toString(), purchaseRate: row.purchaseRate.toString(),
        salesRate: row.salesRate.toString(), reorderLevel: row.reorderLevel.toString(),
        minimumLevel: row.minimumLevel.toString(), maximumLevel: row.maximumLevel?.toString() ?? null,
        groupName: row.groupName, unitSymbol: row.unitSymbol,
        onHand: row.onHand.toString(), stockValue: row.stockValue.toString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      summary: {
        totalQuantity: valuation._sum.quantity?.toString() ?? "0",
        totalValue: valuation._sum.value?.toString() ?? "0",
        lowStockItems: Number(lowStockCount[0]?.count ?? 0),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
