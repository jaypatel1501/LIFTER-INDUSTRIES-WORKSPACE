"use client";

import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { z } from "zod";

const reportSchema = z.object({
  success: z.literal(true),
  data: z.object({
    documents: z.array(z.object({
      id: z.string(), documentNumber: z.string(), documentDate: z.string(), status: z.string(),
      totalAmount: z.string(), taxableAmount: z.string(), costOfGoodsSold: z.string(),
      grossProfit: z.string(), party: z.object({ name: z.string() }),
    })).optional(),
    customers: z.array(z.object({
      partyId: z.string(), name: z.string(), invoiceCount: z.number(),
      sales: z.string(), costOfGoodsSold: z.string(), grossProfit: z.string(),
    })).optional(),
    summary: z.object({ count: z.number(), sales: z.string(), taxableSales: z.string(), tax: z.string(), costOfGoodsSold: z.string(), grossProfit: z.string() }).optional(),
    total: z.number().optional(), page: z.number(), pageSize: z.number(),
  }),
});

export function SalesReports({ locale }: { locale: Locale }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const [view, setView] = useState<"register" | "customers" | "profitability">("register");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useQuery({
    queryKey: ["sales-report", view, search, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ view, page: "1", pageSize: "100" });
      if (search) params.set("search", search);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/sales/reports?${params}`);
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load sales report.");
      return reportSchema.parse(body).data;
    },
  });
  const summary = query.data?.summary;
  const customers = query.data?.customers ?? [];
  const documents = query.data?.documents ?? [];
  const currency = (amount: string) => new Intl.NumberFormat(locale === "HI" ? "hi-IN" : "en-IN", { style: "currency", currency: "INR" }).format(Number(amount));
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold">{copy("Sales reports", "बिक्री रिपोर्ट")}</h1><p className="mt-2 text-sm text-slate-600">{copy("Review sales register, customer sales and gross profitability from posted invoices.", "पोस्ट किए गए इनवॉइस से बिक्री रजिस्टर, ग्राहक बिक्री और सकल लाभ देखें।")}</p></header>
    <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm">{copy("View", "दृश्य")}<select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={view} onChange={(event) => setView(event.target.value as typeof view)}><option value="register">{copy("Sales register", "बिक्री रजिस्टर")}</option><option value="customers">{copy("Customer summary", "ग्राहक सारांश")}</option><option value="profitability">{copy("Profitability", "लाभप्रदता")}</option></select></label>
      <label className="grid gap-1 text-sm">{copy("From date", "आरंभ तारीख")}<Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">{copy("To date", "अंतिम तारीख")}<Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">{copy("Search", "खोजें")}<Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy("Invoice or customer", "इनवॉइस या ग्राहक")} /></label>
    </section>
    {summary && <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {[
        [copy("Invoices", "इनवॉइस"), String(summary.count)],
        [copy("Sales", "बिक्री"), currency(summary.sales)],
        [copy("Taxable sales", "कर योग्य बिक्री"), currency(summary.taxableSales)],
        [copy("GST", "जीएसटी"), currency(summary.tax)],
        [copy("Gross profit", "सकल लाभ"), currency(summary.grossProfit)],
      ].map(([label, amount]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 font-semibold">{amount}</p></div>)}
    </section>}
    <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      {query.isLoading ? <p className="p-5 text-sm text-slate-600">{copy("Loading report…", "रिपोर्ट लोड हो रही है…")}</p>
        : query.isError ? <p role="alert" className="p-5 text-sm text-red-700">{query.error.message}</p>
          : !customers.length && !documents.length ? <p className="p-8 text-center text-sm text-slate-600">{copy("No posted invoices match these filters.", "इन फ़िल्टरों से कोई पोस्ट किया गया इनवॉइस नहीं मिला।")}</p>
            : <table className="w-full min-w-[700px] text-left text-sm">
              <thead><tr className="border-b text-slate-500"><th className="p-2">{view === "customers" ? copy("Customer", "ग्राहक") : copy("Invoice", "इनवॉइस")}</th><th className="p-2">{copy("Date / count", "तारीख / संख्या")}</th><th className="p-2 text-right">{copy("Sales", "बिक्री")}</th><th className="p-2 text-right">{copy("Cost of goods", "माल की लागत")}</th><th className="p-2 text-right">{copy("Gross profit", "सकल लाभ")}</th></tr></thead>
              <tbody>{view === "customers" ? customers.map((row) => <tr key={row.partyId} className="border-b border-slate-100"><td className="p-2">{row.name}</td><td className="p-2">{row.invoiceCount} {copy("invoices", "इनवॉइस")}</td><td className="p-2 text-right">{currency(row.sales)}</td><td className="p-2 text-right">{currency(row.costOfGoodsSold)}</td><td className="p-2 text-right">{currency(row.grossProfit)}</td></tr>) : documents.map((row) => <tr key={row.id} className="border-b border-slate-100"><td className="p-2">{row.documentNumber}<span className="ml-2 text-slate-500">{row.party.name}</span></td><td className="p-2">{new Date(row.documentDate).toLocaleDateString(locale === "HI" ? "hi-IN" : "en-IN")}</td><td className="p-2 text-right">{currency(row.totalAmount)}</td><td className="p-2 text-right">{currency(row.costOfGoodsSold)}</td><td className="p-2 text-right">{currency(row.grossProfit)}</td></tr>)}</tbody>
            </table>}
    </section>
  </div>;
}
