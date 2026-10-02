import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { PartiesManager } from "@/components/accounting/parties-manager";
import { getOpeningBooksDate } from "@/lib/accounting/opening-date";

export const metadata = { title: "Customers & suppliers" };
export const dynamic = "force-dynamic";

export default async function PartiesPage() {
  const session = await auth();
  const context = await requirePermission("parties", "read");
  const canCreate = await hasPermission(context, "parties", "create");
  const booksBeginningDate = await getOpeningBooksDate(context.companyId, context.company.booksBeginningDate);
  return <PartiesManager
    locale={session!.locale}
    canCreate={canCreate}
    companyName={context.company.name}
    booksBeginningDate={booksBeginningDate}
  />;
}
