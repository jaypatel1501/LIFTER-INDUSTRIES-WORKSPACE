import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { SalesReports } from "@/components/sales/sales-reports";

export const metadata = { title: "Sales reports" };
export const dynamic = "force-dynamic";

export default async function SalesReportsPage() {
  const session = await auth();
  await requirePermission("sales-reports", "read");
  return <SalesReports locale={session!.locale} />;
}
