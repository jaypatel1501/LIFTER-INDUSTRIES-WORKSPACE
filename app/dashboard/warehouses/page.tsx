import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { WarehousesManager } from "@/components/inventory/warehouses-manager";

export const metadata = { title: "Godowns and locations" };
export const dynamic = "force-dynamic";

export default async function WarehousesPage() {
  const session = await auth();
  const context = await requirePermission("warehouses", "read");
  const canManage = await hasPermission(context, "warehouses", "manage");
  return <WarehousesManager locale={session!.locale} canManage={canManage} />;
}
