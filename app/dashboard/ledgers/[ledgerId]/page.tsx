import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { LedgerTransactions } from "@/components/accounting/ledger-transactions";

export const dynamic = "force-dynamic";

export default async function LedgerDetailPage({ params }: { params: Promise<{ ledgerId: string }> }) {
  const session = await auth();
  const context = await requirePermission("ledgers", "read");
  const { ledgerId } = await params;
  const canUpdate = await hasPermission(context, "ledgers", "update");
  return <LedgerTransactions locale={session!.locale} ledgerId={ledgerId} canUpdate={canUpdate} />;
}
