import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { DashboardHeader } from "@/components/dashboard/header";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user.id) redirect("/login");
  if (!session.activeCompanyId) redirect("/onboarding/company");

  const context = await requirePermission("company", "read");
  const permissionRows = await prisma.membershipRole.findMany({
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
  const permissions = [...new Set(permissionRows.flatMap(({ role }) =>
    role.permissions.map(({ permission }) => `${permission.resource}:${permission.action}`),
  ))];
  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <Sidebar locale={session.locale} permissions={permissions} />
      <div className="min-w-0 flex-1">
        <DashboardHeader locale={session.locale} />
        <main className="mx-auto w-full max-w-7xl p-4 sm:p-7 lg:p-9" data-company-id={context.companyId}>
          {children}
        </main>
      </div>
    </div>
  );
}
