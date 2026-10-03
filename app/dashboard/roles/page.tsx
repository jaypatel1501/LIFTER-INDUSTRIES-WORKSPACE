import type { Metadata } from "next";
import { RolesManager } from "@/components/company/roles-manager";
import { auth } from "@/lib/auth";
import { managementCopy } from "@/lib/management-copy";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Groups and permissions" };
export const dynamic = "force-dynamic";

export default async function CompanyRolesPage() {
  const session = await auth();
  const context = await requirePermission("roles", "read");
  const rolePermissions = await prisma.membershipRole.findMany({
    where: { membershipId: context.membershipId },
    select: {
      role: {
        select: {
          permissions: { select: { permission: { select: { action: true } } } },
        },
      },
    },
  });
  const canManage = rolePermissions.some(({ role }) =>
    role.permissions.some(({ permission }) => permission.action === "manage"),
  );
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{managementCopy(session?.locale ?? "EN", "Groups and permissions", "समूह और अनुमतियाँ")}</h1>
        <p className="mt-2 text-sm text-slate-600">{context.company.name}</p>
      </div>
      <RolesManager locale={session?.locale ?? "EN"} canManage={canManage} />
    </div>
  );
}
