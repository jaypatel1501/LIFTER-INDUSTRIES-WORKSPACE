"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";

const trialSchema = z.object({
  success: z.literal(true),
  data: z.object({
    rows: z.array(z.object({
      id: z.string(), name: z.string(), code: z.string().nullable(),
      group: z.object({ name: z.string(), nature: z.string() }),
      totalDebit: z.string(), totalCredit: z.string(), balanceDebit: z.string(), balanceCredit: z.string(),
    })),
    totals: z.object({ debitBalance: z.string(), creditBalance: z.string() }),
    total: z.number(), page: z.number(), pageSize: z.number(), asOf: z.string().nullable(), currency: z.string(),
  }),
});
const partySummarySchema = z.object({
  success: z.literal(true),
  data: z.object({
    parties: z.array(z.object({
      id: z.string(), name: z.string(), gstin: z.string().nullable(), state: z.string().nullable(),
      creditPeriodDays: z.number(), creditLimit: z.string(), isActive: z.boolean(),
      ledgerId: z.string().nullable(), ledgerName: z.string().nullable(),
      balanceDebit: z.string(), balanceCredit: z.string(),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(), asOf: z.string().nullable(), currency: z.string(),
  }),
});

export function AccountingReports({ locale }: { locale: Locale }) {
  const [report, setReport] = useState<"TRIAL_BALANCE" | "CUSTOMER" | "SUPPLIER">("TRIAL_BALANCE");
  const [search, setSearch] = useState("");
  const [asOf, setAsOf] = useState("");
  const [page, setPage] = useState(1);
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const trial = useQuery({
    queryKey: ["accounting-trial-balance", search, asOf, page],
    enabled: report === "TRIAL_BALANCE",
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (search) params.set("search", search);
      if (asOf) params.set("asOf", asOf);
      const response = await fetch(`/api/accounting/reports/trial-balance?${params}`);
      if (!response.ok) throw new Error("Could not load trial balance.");
      return trialSchema.parse(await response.json()).data;
    },
  });
  const parties = useQuery({
    queryKey: ["accounting-party-summary", report, search, asOf, page],
    enabled: report !== "TRIAL_BALANCE",
    queryFn: async () => {
      const partyType = report === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
      const params = new URLSearchParams({ type: partyType, page: String(page), pageSize: "50" });
      if (search) params.set("search", search);
      if (asOf) params.set("asOf", asOf);
      const response = await fetch(`/api/accounting/reports/parties?${params}`);
      if (!response.ok) throw new Error("Could not load party summary.");
      return partySummarySchema.parse(await response.json()).data;
    },
  });
  const total = report === "TRIAL_BALANCE" ? trial.data?.total ?? 0 : parties.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 50));
  const activeQuery = report === "TRIAL_BALANCE" ? trial : parties;
  const currency = (value: string, currencyCode: string) => {
    const [whole = "0", fraction = ""] = value.split(".");
    const formatter = new Intl.NumberFormat(locale === "HI" ? "hi-IN" : "en-IN", {
      style: "currency", currency: currencyCode, minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    return formatter.formatToParts(BigInt(whole)).map((part) =>
      part.type === "fraction" ? fraction.padEnd(2, "0").slice(0, 2) : part.value,
    ).join("");
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{copy("Accounting reports", "लेखा रिपोर्ट")}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy("Trial balance is calculated from posted, balanced vouchers. Party summaries show current receivable and payable balances.", "तलपट पोस्ट किए गए संतुलित वाउचर से बनता है। पार्टी सारांश प्राप्य और देय शेष दिखाता है।")}</p>
      </header>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={copy("Accounting reports", "लेखा रिपोर्ट")}>
          {([
            ["TRIAL_BALANCE", "Trial balance", "तलपट"],
            ["CUSTOMER", "Customer summary", "ग्राहक सारांश"],
            ["SUPPLIER", "Supplier summary", "आपूर्तिकर्ता सारांश"],
          ] as const).map(([key, english, hindi]) => <Button key={key} role="tab" aria-selected={report === key} variant={report === key ? "default" : "secondary"} onClick={() => { setReport(key); setPage(1); }}>{copy(english, hindi)}</Button>)}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px]">
          <label className="grid gap-1 text-sm">{copy("Search", "खोजें")}<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
          <label className="grid gap-1 text-sm">{copy("As of date", "तिथि तक")}<Input type="date" value={asOf} onChange={(event) => { setAsOf(event.target.value); setPage(1); }} /></label>
        </div>
        {activeQuery.isPending && <p role="status" className="py-8">{copy("Loading report…", "रिपोर्ट लोड हो रही है…")}</p>}
        {activeQuery.isError && <p role="alert" className="py-8 text-red-700">{activeQuery.error.message}</p>}
        {report === "TRIAL_BALANCE" && trial.data && <>
          {trial.data.rows.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No ledger balances found.", "कोई खाता शेष नहीं मिला।")}</p>}
          {trial.data.rows.length > 0 && <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[750px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Ledger", "खाता")}</th><th>{copy("Group", "समूह")}</th><th className="text-right">{copy("Debit balance", "नामे शेष")}</th><th className="text-right">{copy("Credit balance", "जमा शेष")}</th></tr></thead>
              <tbody className="divide-y">{trial.data.rows.map((row) => <tr key={row.id}><td className="py-3 font-medium"><Link className="text-blue-700 hover:underline" href={`/dashboard/ledgers/${row.id}`}>{row.name}</Link>{row.code && <span className="ml-2 text-xs text-slate-500">{row.code}</span>}</td><td>{row.group.name}</td><td className="text-right tabular-nums">{currency(row.balanceDebit, trial.data.currency)}</td><td className="text-right tabular-nums">{currency(row.balanceCredit, trial.data.currency)}</td></tr>)}</tbody>
              <tfoot className="border-t font-semibold"><tr><td className="py-3" colSpan={2}>{copy("Total", "कुल")}</td><td className="text-right">{currency(trial.data.totals.debitBalance, trial.data.currency)}</td><td className="text-right">{currency(trial.data.totals.creditBalance, trial.data.currency)}</td></tr></tfoot>
            </table>
          </div>}
        </>}
        {report !== "TRIAL_BALANCE" && parties.data && <>
          {parties.data.parties.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No parties found.", "कोई पार्टी नहीं मिली।")}</p>}
          {parties.data.parties.length > 0 && <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Party", "पार्टी")}</th><th>{copy("GSTIN / state", "जीएसटीआईएन / राज्य")}</th><th>{copy("Credit terms", "उधार शर्तें")}</th><th className="text-right">{copy("Receivable", "प्राप्य")}</th><th className="text-right">{copy("Payable", "देय")}</th></tr></thead>
              <tbody className="divide-y">{parties.data.parties.map((party) => <tr key={party.id}><td className="py-3 font-medium"><Link className="text-blue-700 hover:underline" href={`/dashboard/parties/${party.id}`}>{party.name}</Link></td><td>{party.gstin ?? "—"}{party.state && <span className="block text-xs text-slate-500">{party.state}</span>}</td><td>{party.creditPeriodDays} {copy("days", "दिन")} · {currency(party.creditLimit, parties.data.currency)}</td><td className="text-right tabular-nums">{currency(party.balanceDebit, parties.data.currency)}</td><td className="text-right tabular-nums">{currency(party.balanceCredit, parties.data.currency)}</td></tr>)}</tbody>
            </table>
          </div>}
        </>}
        {total > 50 && <div className="mt-4 flex items-center justify-between"><span className="text-sm text-slate-500">{copy("Page", "पृष्ठ")} {page} / {pageCount}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{copy("Previous", "पिछला")}</Button><Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>{copy("Next", "अगला")}</Button></div></div>}
      </section>
    </div>
  );
}
