import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { PurchasesManager } from "@/components/purchases/purchases-manager";

export const metadata = { title: "Purchases" };
export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const session = await auth();
  const context = await requirePermission("purchases", "read");
  const [canCreate, canIssue, canPost, canCancel] = await Promise.all([
    hasPermission(context, "purchases", "create"),
    hasPermission(context, "purchases", "issue"),
    hasPermission(context, "purchases", "post"),
    hasPermission(context, "purchases", "cancel"),
  ]);
  return <PurchasesManager locale={session!.locale} companyName={context.company.name} canCreate={canCreate} canIssue={canIssue} canPost={canPost} canCancel={canCancel} />;
}
