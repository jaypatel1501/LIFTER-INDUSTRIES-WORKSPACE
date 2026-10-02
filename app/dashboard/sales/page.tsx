import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { SalesManager } from "@/components/sales/sales-manager";

export const metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const session = await auth();
  const context = await requirePermission("sales", "read");
  const [canCreate, canIssue, canPost, canSend, canCancel] = await Promise.all([
    hasPermission(context, "sales", "create"),
    hasPermission(context, "sales", "issue"),
    hasPermission(context, "sales", "post"),
    hasPermission(context, "sales", "send"),
    hasPermission(context, "sales", "cancel"),
  ]);
  return <SalesManager
    locale={session!.locale}
    companyName={context.company.name}
    canCreate={canCreate}
    canIssue={canIssue}
    canPost={canPost}
    canSend={canSend}
    canCancel={canCancel}
  />;
}
