import type { Metadata } from "next";
import { UserDetail } from "@/components/company/user-detail";
import { auth } from "@/lib/auth";
import { managementCopy } from "@/lib/management-copy";
import { requirePermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Company user details" };
export const dynamic = "force-dynamic";

export default async function CompanyUserDetailPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const [session, { membershipId }] = await Promise.all([auth(), params]);
  const context = await requirePermission("members", "read");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{managementCopy(session?.locale ?? "EN", "User details", "उपयोगकर्ता विवरण")}</h1>
        <p className="mt-2 text-sm text-slate-600">{context.company.name}</p>
      </div>
      <UserDetail membershipId={membershipId} locale={session?.locale ?? "EN"} />
    </div>
  );
}
