import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { LedgersManager } from "@/components/accounting/ledgers-manager";
import { getOpeningBooksDate } from "@/lib/accounting/opening-date";

export const metadata = { title: "Ledgers" };
export const dynamic = "force-dynamic";

export default async function LedgersPage() {
  const session = await auth();
  const context = await requirePermission("ledgers", "read");
  const canCreate = await hasPermission(context, "ledgers", "create");
  const booksBeginningDate = await getOpeningBooksDate(context.companyId, context.company.booksBeginningDate);
  return <LedgersManager
    locale={session!.locale}
    canCreate={canCreate}
    booksBeginningDate={booksBeginningDate}
  />;
}
