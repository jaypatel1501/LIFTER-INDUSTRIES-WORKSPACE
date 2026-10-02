"use client";

import Link from "next/link";
import { LayoutDashboard, Settings2 } from "lucide-react";
import { getDictionary } from "@/lib/i18n";
import { useDashboardUiStore } from "@/lib/ui-store";
import type { Locale } from "@prisma/client";

export function Sidebar({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale);
  const navigationOpen = useDashboardUiStore((state) => state.mobileNavigationOpen);
  const closeNavigation = useDashboardUiStore((state) => state.closeMobileNavigation);
  return (
    <aside className={`${navigationOpen ? "flex" : "hidden"} w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:flex lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r`}>
      <Link href="/dashboard" className="flex items-center gap-3 px-5 py-5">
        <span className="grid size-10 place-items-center rounded-xl bg-blue-700 text-lg font-bold text-white">E</span>
        <span className="font-semibold tracking-tight text-slate-950">{copy.appName}</span>
      </Link>
      <nav id="primary-navigation" aria-label="Main navigation" className="flex gap-1 px-3 pb-3 lg:flex-col lg:px-3 lg:py-3">
        <Link
          href="/dashboard"
          onClick={closeNavigation}
          className="flex items-center gap-3 rounded-lg bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-800"
        >
          <LayoutDashboard aria-hidden="true" size={18} />
          {copy.overview}
        </Link>
        <Link
          href="/dashboard/preferences"
          onClick={closeNavigation}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          <Settings2 aria-hidden="true" size={18} />
          {copy.preferences}
        </Link>
      </nav>
      <div className="mt-auto hidden border-t border-slate-100 p-5 text-xs leading-5 text-slate-500 lg:block">
        {copy.secureWorkspace}
      </div>
    </aside>
  );
}
