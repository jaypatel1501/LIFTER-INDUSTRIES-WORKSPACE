import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { StockItemDetail } from "@/components/inventory/stock-item-detail";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ itemId: string }> };

export default async function StockItemDetailPage(route: RouteContext) {
  const [session, context] = await Promise.all([auth(), requirePermission("inventory", "read")]);
  const canUpdate = await hasPermission(context, "inventory", "update");
  const canReadMovements = await hasPermission(context, "inventory-movements", "read");
  const { itemId } = await route.params;
  return <StockItemDetail itemId={itemId} locale={session!.locale} canUpdate={canUpdate} canReadMovements={canReadMovements} />;
}
