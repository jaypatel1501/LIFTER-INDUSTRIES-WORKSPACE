import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { VoucherSeriesManager } from "@/components/accounting/voucher-series-manager";

export const metadata = { title: "Voucher number series" };
export const dynamic = "force-dynamic";

export default async function VoucherSeriesPage() {
  const session = await auth();
  await requirePermission("voucher-series", "manage");
  return <VoucherSeriesManager locale={session!.locale} />;
}
