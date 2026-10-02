import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { VoucherDetail } from "@/components/accounting/voucher-detail";

export const metadata = { title: "Voucher details" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ voucherId: string }> };

export default async function VoucherDetailPage({ params }: PageProps) {
  const [{ voucherId }, session] = await Promise.all([params, auth()]);
  const context = await requirePermission("vouchers", "read");
  const [
    canUpdate, canPost, canCancel, canReverse, canApprove,
  ] = await Promise.all([
    hasPermission(context, "vouchers", "update"),
    hasPermission(context, "vouchers", "post"),
    hasPermission(context, "vouchers", "cancel"),
    hasPermission(context, "vouchers", "reverse"),
    hasPermission(context, "vouchers", "approve"),
  ]);
  if (!session?.locale) notFound();
  return <VoucherDetail
    locale={session.locale}
    voucherId={voucherId}
    capabilities={{ canUpdate, canPost, canCancel, canReverse, canApprove }}
  />;
}
