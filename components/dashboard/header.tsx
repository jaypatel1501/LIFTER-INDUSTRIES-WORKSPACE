"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { ChevronDown, LogOut, PanelLeft } from "lucide-react";
import { getDictionary, localeLabel } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useDashboardUiStore } from "@/lib/ui-store";
import { companyListResponseSchema } from "@/lib/validation/companies";

export function DashboardHeader({
  locale,
}: {
  locale: Locale;
}) {
  const router = useRouter();
  const { data: session, update } = useSession();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const toggleNavigation = useDashboardUiStore((state) => state.toggleMobileNavigation);
  const navigationOpen = useDashboardUiStore((state) => state.mobileNavigationOpen);
  const companiesQuery = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const response = await fetch("/api/companies");
      if (!response.ok) throw new Error("Company list request failed");
      const body: unknown = await response.json();
      return companyListResponseSchema.parse(body).data;
    },
  });
  const companyMutation = useMutation({
    mutationFn: async (companyId: string) => {
      const response = await fetch("/api/companies/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!response.ok) throw new Error("Company membership check failed");
      const body = await response.json() as {
        data?: { switchProof: string };
      };
      if (!body.data?.switchProof) throw new Error("Company switch proof was not returned");
      const updatedSession = await update({
        activeCompanyId: companyId,
        switchProof: body.data.switchProof,
      });
      if (updatedSession?.activeCompanyId !== companyId) {
        throw new Error("Company switch was not authorized");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["companies"] });
      router.refresh();
    },
    onError: () => setMessage("Could not switch company. Please retry."),
  });
  const localeMutation = useMutation({
    mutationFn: async (nextLocale: Locale) => {
      const response = await fetch("/api/profile/locale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (!response.ok) throw new Error("Preference update failed");
      await update();
    },
    onSuccess: () => router.refresh(),
    onError: () => setMessage("Could not save your language preference."),
  });
  const copy = getDictionary(locale);
  const busy = companyMutation.isPending || localeMutation.isPending;
  const companies = companiesQuery.data?.companies ?? [];
  const activeCompanyId = session?.activeCompanyId ?? "";
  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-7">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="lg:hidden"
        aria-label="Toggle navigation"
        aria-controls="primary-navigation"
        aria-expanded={navigationOpen}
        onClick={toggleNavigation}
      >
        <PanelLeft size={19} aria-hidden="true" />
      </Button>
      <div className="min-w-0">
        <label htmlFor="active-company" className="sr-only">{copy.switchCompany}</label>
        <div className="relative">
          <select
            id="active-company"
            value={activeCompanyId}
            disabled={busy || companiesQuery.isPending || companies.length < 2}
            onChange={(event) => companyMutation.mutate(event.target.value)}
            className="max-w-52 appearance-none truncate rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-9 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-70"
          >
            {companiesQuery.isPending && <option value="">Loading companies…</option>}
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{company.name}</option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-2.5 text-slate-500" size={16} />
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <label htmlFor="locale" className="sr-only">{copy.language}</label>
        <select
          id="locale"
          value={locale}
          disabled={busy}
          onChange={(event) => localeMutation.mutate(event.target.value as Locale)}
          className="max-w-40 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
        >
          {(["EN", "HI", "BILINGUAL"] as const).map((value) => (
            <option key={value} value={value}>{localeLabel(value)}</option>
          ))}
        </select>
        <span className="hidden max-w-36 truncate text-sm text-slate-600 md:block" title={session?.user?.email ?? undefined}>
          {session?.user?.name || session?.user?.email}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={copy.signOut}
          onClick={() => void signOut({ redirectTo: "/login" })}
        >
          <LogOut size={17} aria-hidden="true" />
          <span className="hidden sm:inline">{copy.signOut}</span>
        </Button>
      </div>
      {(message || companiesQuery.isError) && (
        <p role="status" className="w-full text-right text-sm text-red-700">
          {message || "Could not load your company memberships."}
        </p>
      )}
    </header>
  );
}
