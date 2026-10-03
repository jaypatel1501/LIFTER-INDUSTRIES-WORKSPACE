"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { ledgerUpdateSchema } from "@/lib/validation/accounting";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    ledger: z.object({
      id: z.string(), name: z.string(), code: z.string().nullable(),
      type: z.string(), groupId: z.string(), costCentreEnabled: z.boolean(),
      interestEnabled: z.boolean(), interestRate: z.string().nullable(), isActive: z.boolean(),
      isSystem: z.boolean(), partyId: z.string().nullable(), group: z.object({ name: z.string() }),
    }),
    transactions: z.array(z.object({
      id: z.string(), debit: z.string(), credit: z.string(),
      voucher: z.object({ id: z.string(), voucherNumber: z.string(), type: z.string(), status: z.string(), voucherDate: z.string(), narration: z.string().nullable() }),
      billDetails: z.array(z.object({ id: z.string(), referenceNumber: z.string(), dueDate: z.string(), amount: z.string() })),
    })),
    totalDebit: z.string(), totalCredit: z.string(), balanceDebit: z.string(), balanceCredit: z.string(),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});

export function LedgerTransactions({ locale, ledgerId, canUpdate }: {
  locale: Locale; ledgerId: string; canUpdate: boolean;
}) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [settings, setSettings] = useState<{ name: string; groupId: string; costCentreEnabled: boolean; interestEnabled: boolean; interestRate: string; isActive: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["accounting-ledger-transactions", ledgerId, search, from, to, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (search) params.set("search", search);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/accounting/ledgers/${ledgerId}/transactions?${params}`);
      if (!response.ok) throw new Error(response.status === 404 ? "Ledger not found." : "Could not load ledger transactions.");
      return responseSchema.parse(await response.json()).data;
    },
  });
  const ledger = query.data?.ledger;
  const editable = Boolean(canUpdate && ledger && !ledger.isSystem && !ledger.partyId);
  const groups = useQuery({
    queryKey: ["accounting-ledger-groups"],
    enabled: editable,
    queryFn: async () => {
      const response = await fetch("/api/accounting/groups");
      if (!response.ok) throw new Error("Could not load account groups.");
      const body = await response.json() as { success: boolean; data?: { groups: { id: string; name: string }[] } };
      if (!body.success || !body.data) throw new Error("Could not load account groups.");
      return body.data.groups;
    },
  });
  const currentSettings = settings ?? (ledger ? {
    name: ledger.name,
    groupId: ledger.groupId,
    costCentreEnabled: ledger.costCentreEnabled,
    interestEnabled: ledger.interestEnabled,
    interestRate: ledger.interestRate ?? "",
    isActive: ledger.isActive,
  } : null);
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!currentSettings) throw new Error("Ledger settings are not available.");
      const payload = {
        name: currentSettings.name,
        groupId: currentSettings.groupId,
        costCentreEnabled: currentSettings.costCentreEnabled,
        interestEnabled: currentSettings.interestEnabled,
        isActive: currentSettings.isActive,
        ...(currentSettings.interestRate ? { interestRate: currentSettings.interestRate } : {}),
      };
      const parsed = ledgerUpdateSchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid ledger settings.");
      const response = await fetch(`/api/accounting/ledgers/${ledgerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update ledger.");
    },
    onSuccess: async () => {
      setSettings(null);
      setMessage(copy("Ledger settings updated.", "खाता सेटिंग अपडेट हुई।"));
      await queryClient.invalidateQueries({ queryKey: ["accounting-ledger-transactions", ledgerId] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-ledgers"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const updateSetting = (key: keyof NonNullable<typeof currentSettings>, value: string | boolean) => {
    if (!currentSettings) return;
    setSettings({ ...currentSettings, [key]: value });
  };
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  return (
    <div className="space-y-6">
      <header>
        <Link href="/dashboard/ledgers" className="text-sm text-blue-700 hover:underline">← {copy("Ledgers", "खाते")}</Link>
        {query.data && <>
          <h1 className="mt-2 text-2xl font-semibold">{query.data.ledger.name}</h1>
          <p className="mt-1 text-sm text-slate-600">{query.data.ledger.group.name}{query.data.ledger.code ? ` · ${query.data.ledger.code}` : ""}</p>
        </>}
      </header>
      {query.data && <section className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{copy("Closing debit balance", "अंतिम नामे शेष")}</p><p className="mt-1 text-xl font-semibold">{query.data.balanceDebit}</p><p className="mt-2 text-xs text-slate-500">{copy("Total debits", "कुल नामे")}: {query.data.totalDebit}</p></article>
        <article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{copy("Closing credit balance", "अंतिम जमा शेष")}</p><p className="mt-1 text-xl font-semibold">{query.data.balanceCredit}</p><p className="mt-2 text-xs text-slate-500">{copy("Total credits", "कुल जमा")}: {query.data.totalCredit}</p></article>
      </section>}
      {editable && currentSettings && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Ledger settings", "खाता सेटिंग")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-sm">{copy("Ledger name", "खाते का नाम")}<Input value={currentSettings.name} onChange={(event) => updateSetting("name", event.target.value)} /></label>
          {groups.data && <label className="grid gap-1 text-sm">{copy("Account group", "खाता समूह")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={currentSettings.groupId} onChange={(event) => updateSetting("groupId", event.target.value)}>
              {groups.data.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={currentSettings.costCentreEnabled} onChange={(event) => updateSetting("costCentreEnabled", event.target.checked)} />{copy("Cost-centre allocation", "लागत केंद्र आवंटन")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={currentSettings.interestEnabled} onChange={(event) => updateSetting("interestEnabled", event.target.checked)} />{copy("Track interest", "ब्याज ट्रैक करें")}</label>
          {currentSettings.interestEnabled && <label className="grid gap-1 text-sm">{copy("Interest rate (%)", "ब्याज दर (%)")}<Input inputMode="decimal" value={currentSettings.interestRate} onChange={(event) => updateSetting("interestRate", event.target.value)} /></label>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={currentSettings.isActive} onChange={(event) => updateSetting("isActive", event.target.checked)} />{copy("Active", "सक्रिय")}</label>
        </div>
        {groups.isError && <p role="alert" className="mt-3 text-sm text-red-700">{groups.error.message}</p>}
        <div className="mt-4 flex items-center gap-3"><Button disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>{copy(updateMutation.isPending ? "Saving…" : "Save ledger", updateMutation.isPending ? "सहेजा जा रहा है…" : "खाता सहेजें")}</Button>{message && <p role="status" className="text-sm text-slate-600">{message}</p>}</div>
      </section>}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Transaction history", "लेन-देन इतिहास")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">{copy("Voucher search", "वाउचर खोजें")}<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
          <label className="grid gap-1 text-sm">{copy("From date", "प्रारंभ तिथि")}<Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
          <label className="grid gap-1 text-sm">{copy("To date", "समाप्ति तिथि")}<Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
        </div>
        {query.isPending && <p role="status" className="py-8">{copy("Loading transactions…", "लेन-देन लोड हो रहे हैं…")}</p>}
        {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
        {query.data?.transactions.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No posted transactions found.", "कोई पोस्ट किया गया लेन-देन नहीं मिला।")}</p>}
        {query.data?.transactions.map((line) => <article key={line.id} className="mt-3 rounded-lg border border-slate-100 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{line.voucher.voucherNumber}</strong><span className="ml-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-800">{line.voucher.type}</span></div><time className="text-sm text-slate-500">{new Intl.DateTimeFormat(locale === "HI" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(line.voucher.voucherDate))}</time></div>
          <p className="mt-2 text-sm text-slate-600">{line.voucher.narration ?? "—"}</p>
          <p className="mt-2 text-sm">{copy("Debit", "नामे")}: {line.debit} · {copy("Credit", "जमा")}: {line.credit}</p>
          {line.billDetails.map((bill) => <p key={bill.id} className="mt-2 text-xs text-slate-500">{bill.referenceNumber} · {bill.amount} · {new Intl.DateTimeFormat(locale === "HI" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(bill.dueDate))}</p>)}
        </article>)}
        {query.data && query.data.total > 25 && <div className="mt-4 flex items-center justify-between"><span className="text-sm text-slate-500">{copy("Page", "पृष्ठ")} {page} / {pageCount}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{copy("Previous", "पिछला")}</Button><Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>{copy("Next", "अगला")}</Button></div></div>}
      </section>
    </div>
  );
}
