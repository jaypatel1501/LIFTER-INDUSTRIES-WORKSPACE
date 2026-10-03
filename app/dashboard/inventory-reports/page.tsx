import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { InventoryReports } from "@/components/inventory/inventory-reports";

export const metadata = { title: "Inventory reports" };
export const dynamic = "force-dynamic";

export default async function InventoryReportsPage() {
  const session = await auth();
  await requirePermission("inventory", "read");
  return <InventoryReports locale={session!.locale} />;
}
