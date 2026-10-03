import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { PurchaseReports } from "@/components/purchases/purchase-reports";

export const metadata = { title: "Purchase reports" };
export const dynamic = "force-dynamic";

export default async function PurchaseReportsPage() {
  const session = await auth();
  await requirePermission("purchase-reports", "read");
  return <PurchaseReports locale={session!.locale} />;
}
