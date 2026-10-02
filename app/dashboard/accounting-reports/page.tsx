import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { AccountingReports } from "@/components/accounting/accounting-reports";

export const metadata = { title: "Accounting reports" };
export const dynamic = "force-dynamic";

export default async function AccountingReportsPage() {
  const session = await auth();
  await requirePermission("vouchers", "read");
  return <AccountingReports locale={session!.locale} />;
}
