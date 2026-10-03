import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { UnitsManager } from "@/components/inventory/units-manager";

export const metadata = { title: "Units of measure" };
export const dynamic = "force-dynamic";

export default async function UnitsPage() {
  const session = await auth();
  const context = await requirePermission("units", "read");
  const canManage = await hasPermission(context, "units", "manage");
  return <UnitsManager locale={session!.locale} canManage={canManage} />;
}
