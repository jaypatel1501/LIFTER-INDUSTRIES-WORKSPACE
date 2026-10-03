import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { TaxTransactionsManager } from "@/components/accounting/tax-transactions-manager";

export const metadata = { title: "Tax transactions" };
export const dynamic = "force-dynamic";

export default async function TaxTransactionsPage() {
  const session = await auth();
  await requirePermission("vouchers", "read");
  return <TaxTransactionsManager locale={session!.locale} />;
}
