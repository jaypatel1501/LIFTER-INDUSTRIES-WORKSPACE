"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { ledgerCreateSchema } from "@/lib/validation/accounting";

const groupResponse = z.object({
  success: z.literal(true),
  data: z.object({ groups: z.array(z.object({ id: z.string(), name: z.string(), code: z.string(), nature: z.string() })) }),
});
const listResponse = z.object({
  success: z.literal(true),
  data: z.object({
    ledgers: z.array(z.object({
      id: z.string(), name: z.string(), code: z.string().nullable(), type: z.string(),
      costCentreEnabled: z.boolean(), interestEnabled: z.boolean(), interestRate: z.string().nullable(),
      isActive: z.boolean(), group: z.object({ id: z.string(), name: z.string(), nature: z.string() }),
      party: z.object({ id: z.string(), type: z.string() }).nullable(),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});
type FormValues = z.input<typeof ledgerCreateSchema>;

export function LedgersManager({ locale, canCreate, booksBeginningDate }: {
  locale: Locale; canCreate: boolean; booksBeginningDate: string;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const groupsQuery = useQuery({
    queryKey: ["accounting-ledger-groups"],
    queryFn: async () => {
      const response = await fetch("/api/accounting/groups");
      if (!response.ok) throw new Error("Could not load account groups.");
      return groupResponse.parse(await response.json()).data.groups;
    },
  });
  const query = useQuery({
    queryKey: ["accounting-ledgers", search, groupId, status, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (search) params.set("search", search);
      if (groupId) params.set("groupId", groupId);
      if (status) params.set("status", status);
      const response = await fetch(`/api/accounting/ledgers?${params}`);
      if (!response.ok) throw new Error("Could not load ledgers.");
      return listResponse.parse(await response.json()).data;
    },
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(ledgerCreateSchema),
    defaultValues: {
      name: "", groupId: "", code: "", type: "GENERAL", costCentreEnabled: false,
      interestEnabled: false, interestRate: "",
      openingBalance: { amount: "0", side: "DEBIT", date: booksBeginningDate || new Date().toISOString().slice(0, 10), bills: [] },
    },
  });
  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await fetch("/api/accounting/ledgers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(values),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not create ledger.");
    },
    onSuccess: async () => {
      form.reset();
      setMessage(copy("Ledger saved.", "खाता सहेजा गया।"));
      await queryClient.invalidateQueries({ queryKey: ["accounting-ledgers"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  const interestEnabled = useWatch({ control: form.control, name: "interestEnabled" });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{copy("Ledgers", "खाते")}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy("Create cash, bank, tax, income, expense and general accounts. Posted balances cannot be overwritten; they remain visible through vouchers and reports.", "नकद, बैंक, कर, आय, व्यय और सामान्य खाते बनाएँ। पोस्ट किए गए शेष वाउचर और रिपोर्ट में सुरक्षित रहते हैं।")}</p>
      </header>
      {canCreate && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Create a ledger", "खाता बनाएँ")}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
          <label className="grid gap-1 text-sm">{copy("Ledger name", "खाते का नाम")}<Input {...form.register("name")} /></label>
          <label className="grid gap-1 text-sm">{copy("Ledger code (optional)", "खाता कोड (वैकल्पिक)")}<Input {...form.register("code")} /></label>
          <label className="grid gap-1 text-sm">{copy("Account group", "खाता समूह")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" {...form.register("groupId")}>
              <option value="">{copy("Select group", "समूह चुनें")}</option>
              {groupsQuery.data?.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.nature}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">{copy("Status", "स्थिति")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">{copy("All", "सभी")}</option><option value="ACTIVE">{copy("Active", "सक्रिय")}</option><option value="INACTIVE">{copy("Inactive", "निष्क्रिय")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">{copy("Ledger type", "खाता प्रकार")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" {...form.register("type")}>
              {["GENERAL", "CASH", "BANK", "TAX", "INCOME", "EXPENSE"].map((type) => <option key={type} value={type}>{copy(type[0]! + type.slice(1).toLowerCase(), ({ GENERAL: "सामान्य", CASH: "नकद", BANK: "बैंक", TAX: "कर", INCOME: "आय", EXPENSE: "व्यय" } as Record<string, string>)[type]!)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("costCentreEnabled")} />{copy("Enable cost-centre allocation", "लागत केंद्र आवंटन सक्षम करें")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("interestEnabled")} />{copy("Track interest", "ब्याज ट्रैक करें")}</label>
          {interestEnabled && <label className="grid gap-1 text-sm">{copy("Interest rate (%)", "ब्याज दर (%)")}<Input inputMode="decimal" {...form.register("interestRate")} /></label>}
          <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:col-span-2 lg:col-span-3">
            <legend className="px-1 text-sm font-medium">{copy("Opening balance", "प्रारंभिक शेष")}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">{copy("Amount", "राशि")}<Input inputMode="decimal" {...form.register("openingBalance.amount")} /></label>
              <label className="grid gap-1 text-sm">{copy("Side", "पक्ष")}
                <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" {...form.register("openingBalance.side")}><option value="DEBIT">{copy("Debit", "नामे")}</option><option value="CREDIT">{copy("Credit", "जमा")}</option></select>
              </label>
              <label className="grid gap-1 text-sm">{copy("Opening date", "प्रारंभ तिथि")}<Input type="date" {...form.register("openingBalance.date")} /></label>
            </div>
          </fieldset>
          {Object.values(form.formState.errors).map((error, index) => error && <p key={index} role="alert" className="text-sm text-red-700 sm:col-span-2 lg:col-span-3">{error.message ?? "Check the entered fields."}</p>)}
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={createMutation.isPending || groupsQuery.isError}>{copy(createMutation.isPending ? "Saving…" : "Create ledger", createMutation.isPending ? "सहेजा जा रहा है…" : "खाता बनाएँ")}</Button>
            {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
            {groupsQuery.isError && <p role="alert" className="text-sm text-red-700">{groupsQuery.error.message}</p>}
          </div>
        </form>
      </section>}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-56 flex-1 gap-1 text-sm">{copy("Search ledgers", "खाते खोजें")}<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
          <label className="grid gap-1 text-sm">{copy("Account group", "खाता समूह")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={groupId} onChange={(event) => { setGroupId(event.target.value); setPage(1); }}>
              <option value="">{copy("All groups", "सभी समूह")}</option>{groupsQuery.data?.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
        </div>
        {query.isPending && <p role="status" className="py-8">{copy("Loading ledgers…", "खाते लोड हो रहे हैं…")}</p>}
        {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
        {query.data?.ledgers.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No ledgers found.", "कोई खाता नहीं मिला।")}</p>}
        {query.data && query.data.ledgers.length > 0 && <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Name", "नाम")}</th><th>{copy("Type", "प्रकार")}</th><th>{copy("Group", "समूह")}</th><th>{copy("Cost centre", "लागत केंद्र")}</th><th>{copy("Interest", "ब्याज")}</th><th>{copy("Status", "स्थिति")}</th></tr></thead>
            <tbody className="divide-y">{query.data.ledgers.map((ledger) => <tr key={ledger.id}>
              <td className="py-3 font-medium"><Link className="text-blue-700 hover:underline" href={`/dashboard/ledgers/${ledger.id}`}>{ledger.name}</Link>{ledger.code && <span className="block text-xs text-slate-500">{ledger.code}</span>}</td>
              <td>{ledger.party ? copy(ledger.party.type === "CUSTOMER" ? "Customer" : "Supplier", ledger.party.type === "CUSTOMER" ? "ग्राहक" : "आपूर्तिकर्ता") : copy(ledger.type[0]! + ledger.type.slice(1).toLowerCase(), ledger.type)}</td>
              <td>{ledger.group.name}</td><td>{ledger.costCentreEnabled ? copy("Enabled", "सक्षम") : "—"}</td><td>{ledger.interestEnabled ? `${ledger.interestRate ?? "—"}%` : "—"}</td><td>{ledger.isActive ? copy("Active", "सक्रिय") : copy("Inactive", "निष्क्रिय")}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {query.data && query.data.total > 25 && <div className="mt-4 flex items-center justify-between"><span className="text-sm text-slate-500">{copy("Page", "पृष्ठ")} {page} / {pageCount}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{copy("Previous", "पिछला")}</Button><Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>{copy("Next", "अगला")}</Button></div></div>}
      </section>
    </div>
  );
}
