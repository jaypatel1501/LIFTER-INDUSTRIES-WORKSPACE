import type { Metadata } from "next";
import { Building2, CircleCheck, ShieldCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n";
import { requireCompanyContext } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user.id) return null;
  const context = await requireCompanyContext();
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { id: context.membershipId },
    select: {
      createdAt: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  const copy = getDictionary(session.locale);
  const date = new Intl.DateTimeFormat(
    session.locale === "HI" ? "hi-IN" : "en-IN",
    { dateStyle: "long", timeZone: context.company.timezone },
  ).format(new Date());

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-700">{copy.overview}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{copy.workspaceReady}</h1>
          <p className="mt-2 text-sm text-slate-600">{copy.workspaceDescription}</p>
        </div>
        <p className="text-sm text-slate-500">{date}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">{copy.company}</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">{context.company.name}</h2>
            </div>
            <span className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-700">
              <Building2 aria-hidden="true" size={21} />
            </span>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-slate-500">{copy.currency}</p>
              <p className="mt-1 font-medium text-slate-900">{context.company.currency}</p>
            </div>
            <div>
              <p className="text-slate-500">{copy.timeZone}</p>
              <p className="mt-1 font-medium text-slate-900">{context.company.timezone}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">{copy.yourAccess}</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {membership.roles.map(({ role }) => role.name).join(", ") || copy.member}
              </h2>
            </div>
            <span className="grid size-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <ShieldCheck aria-hidden="true" size={21} />
            </span>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-slate-600">
            <CircleCheck aria-hidden="true" className="text-emerald-600" size={17} />
            {copy.memberSince} {new Intl.DateTimeFormat(
              session.locale === "HI" ? "hi-IN" : "en-IN",
              { dateStyle: "medium" },
            ).format(membership.createdAt)}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 py-8 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600">
            <CircleCheck aria-hidden="true" size={20} />
          </span>
          <div>
            <h2 className="font-semibold text-slate-900">{copy.businessModules}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {copy.moduleDescription}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
