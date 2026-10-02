import type { Metadata } from "next";
import { CompanySettingsForm } from "@/components/company/company-settings-form";
import { auth } from "@/lib/auth";
import { managementCopy } from "@/lib/management-copy";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Company settings" };
export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const session = await auth();
  const context = await requirePermission("company", "read");
  const permissionRows = await prisma.membershipRole.findMany({
    where: { membershipId: context.membershipId },
    select: {
      role: {
        select: {
          permissions: { select: { permission: { select: { resource: true, action: true } } } },
        },
      },
    },
  });
  const canUpdate = permissionRows.some(({ role }) =>
    role.permissions.some(({ permission }) => permission.resource === "company" && permission.action === "update"),
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">
          {managementCopy(session?.locale ?? "EN", "Company settings", "कंपनी सेटिंग")}
        </h1>
        <p className="mt-2 text-sm text-slate-600">{context.company.name}</p>
      </div>
      <CompanySettingsForm locale={session?.locale ?? "EN"} canUpdate={canUpdate} />
    </div>
  );
}
