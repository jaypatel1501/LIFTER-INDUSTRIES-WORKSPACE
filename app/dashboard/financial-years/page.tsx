import type { Metadata } from "next";
import { FinancialYearsManager } from "@/components/company/financial-years-manager";
import { auth } from "@/lib/auth";
import { managementCopy } from "@/lib/management-copy";
import { requirePermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Financial years" };
export const dynamic = "force-dynamic";

export default async function FinancialYearsPage() {
  const session = await auth();
  const context = await requirePermission("financial-years", "read");
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
  const actions = new Set(rows.flatMap(({ role }) =>
    role.permissions
      .filter(({ permission }) => permission.resource === "financial-years")
      .map(({ permission }) => permission.action),
  ));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{managementCopy(session?.locale ?? "EN", "Financial years", "वित्तीय वर्ष")}</h1>
        <p className="mt-2 text-sm text-slate-600">{context.company.name}</p>
      </div>
      <FinancialYearsManager locale={session?.locale ?? "EN"} canManage={actions.has("manage")} canClose={actions.has("close")} />
    </div>
  );
}
