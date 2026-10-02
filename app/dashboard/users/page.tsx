import type { Metadata } from "next";
import { UsersManager } from "@/components/company/users-manager";
import { auth } from "@/lib/auth";
import { managementCopy } from "@/lib/management-copy";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Company users" };
export const dynamic = "force-dynamic";

export default async function CompanyUsersPage() {
  const session = await auth();
  const context = await requirePermission("members", "read");
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
  const canManageRoles = rows.some(({ role }) =>
    role.permissions.some(({ permission }) => permission.resource === "roles" && permission.action === "manage"),
  );
  const canInvite = rows.some(({ role }) =>
    role.permissions.some(({ permission }) => permission.resource === "members" && permission.action === "invite"),
  );
  const canUpdate = rows.some(({ role }) =>
    role.permissions.some(({ permission }) => permission.resource === "members" && permission.action === "update"),
  );
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{managementCopy(session?.locale ?? "EN", "Company users", "कंपनी उपयोगकर्ता")}</h1>
        <p className="mt-2 text-sm text-slate-600">{context.company.name}</p>
      </div>
      <UsersManager
        locale={session?.locale ?? "EN"}
        canManageRoles={canManageRoles}
        canInvite={canInvite}
        canUpdate={canUpdate}
      />
    </div>
  );
}
