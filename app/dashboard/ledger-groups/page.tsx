import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { LedgerGroupsManager } from "@/components/accounting/ledger-groups-manager";

export const metadata = { title: "Ledger groups" };
export const dynamic = "force-dynamic";

export default async function LedgerGroupsPage() {
  const session = await auth();
  const context = await requirePermission("ledger-groups", "read");
  const canManage = await hasPermission(context, "ledger-groups", "manage");
  return <LedgerGroupsManager locale={session!.locale} canManage={canManage} />;
}
