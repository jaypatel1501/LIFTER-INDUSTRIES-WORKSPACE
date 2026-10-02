import type { Metadata } from "next";
import { SecurityHistory } from "@/components/company/security-history";
import { auth } from "@/lib/auth";
import { managementCopy } from "@/lib/management-copy";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Login and session history" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await auth();
  const context = await requirePermission("sessions", "read");
  const rows = await prisma.membershipRole.findMany({
    where: { membershipId: context.membershipId },
    select: {
      role: {
        select: {
          permissions: {
            select: { permission: { select: { resource: true, action: true } } },
          },
        },
      },
    },
  });
  const canRevoke = rows.some(({ role }) =>
    role.permissions.some(({ permission }) =>
      permission.resource === "sessions" && permission.action === "revoke",
    ),
  );
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{managementCopy(session?.locale ?? "EN", "Security history", "सुरक्षा इतिहास")}</h1>
        <p className="mt-2 text-sm text-slate-600">{context.company.name}</p>
      </div>
      <SecurityHistory locale={session?.locale ?? "EN"} canRevoke={canRevoke} />
    </div>
  );
}
