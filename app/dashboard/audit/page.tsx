import type { Metadata } from "next";
import { AuditHistory } from "@/components/company/audit-history";
import { auth } from "@/lib/auth";
import { managementCopy } from "@/lib/management-copy";
import { requirePermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Company audit trail" };
export const dynamic = "force-dynamic";

export default async function CompanyAuditPage() {
  const session = await auth();
  const context = await requirePermission("audit", "read");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{managementCopy(session?.locale ?? "EN", "Audit trail", "ऑडिट ट्रेल")}</h1>
        <p className="mt-2 text-sm text-slate-600">{context.company.name}</p>
      </div>
      <AuditHistory locale={session?.locale ?? "EN"} />
    </div>
  );
}
