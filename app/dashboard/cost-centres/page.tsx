import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { CostCentresManager } from "@/components/accounting/cost-centres-manager";

export const metadata = { title: "Cost centres" };
export const dynamic = "force-dynamic";

export default async function CostCentresPage() {
  const session = await auth();
  const context = await requirePermission("vouchers", "read");
  const canManage = await hasPermission(context, "cost-centres", "manage");
  return <CostCentresManager locale={session!.locale} canManage={canManage} />;
}
