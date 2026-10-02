import { auth } from "@/lib/auth";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { PartyDetail } from "@/components/accounting/party-detail";

export const dynamic = "force-dynamic";

export default async function PartyDetailPage({ params }: { params: Promise<{ partyId: string }> }) {
  const session = await auth();
  const context = await requirePermission("parties", "read");
  const { partyId } = await params;
  const canUpdate = await hasPermission(context, "parties", "update");
  return <PartyDetail locale={session!.locale} partyId={partyId} canUpdate={canUpdate} />;
}
