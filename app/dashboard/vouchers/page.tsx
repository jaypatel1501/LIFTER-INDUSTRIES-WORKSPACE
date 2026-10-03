import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { VouchersManager } from "@/components/accounting/vouchers-manager";

export const metadata = { title: "Vouchers" };
export const dynamic = "force-dynamic";

export default async function VouchersPage() {
  const session = await auth();
  const context = await requirePermission("vouchers", "read");
  const canCreate = await hasPermission(context, "vouchers", "create");
  return <VouchersManager locale={session!.locale} canCreate={canCreate} />;
}
