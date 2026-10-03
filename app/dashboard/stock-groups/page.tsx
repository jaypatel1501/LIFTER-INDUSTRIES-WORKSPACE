import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { StockGroupsManager } from "@/components/inventory/stock-groups-manager";

export const metadata = { title: "Stock groups" };
export const dynamic = "force-dynamic";

export default async function StockGroupsPage() {
  const session = await auth();
  const context = await requirePermission("stock-groups", "read");
  const canManage = await hasPermission(context, "stock-groups", "manage");
  return <StockGroupsManager locale={session!.locale} canManage={canManage} />;
}
