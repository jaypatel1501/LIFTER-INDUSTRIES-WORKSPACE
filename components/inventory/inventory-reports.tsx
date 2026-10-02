"use client";

import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";

const summarySchema = z.object({
  success: z.literal(true),
  data: z.object({
    rows: z.array(z.object({
      id: z.string(), name: z.string(), code: z.string().nullable(), hsnSac: z.string().nullable(),
      gstRate: z.string(), purchaseRate: z.string(), salesRate: z.string(),
      reorderLevel: z.string(), minimumLevel: z.string(), maximumLevel: z.string().nullable(),
      groupName: z.string(), unitSymbol: z.string(), onHand: z.string(), stockValue: z.string(),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
    summary: z.object({ totalQuantity: z.string(), totalValue: z.string(), lowStockItems: z.number() }),
  }),
});
const expirySchema = z.object({
  success: z.literal(true),
  data: z.object({
    batches: z.array(z.object({
      id: z.string(), quantity: z.string(), value: z.string(),
      item: z.object({ id: z.string(), name: z.string(), code: z.string().nullable(), hsnSac: z.string().nullable(), baseUnit: z.object({ symbol: z.string() }) }),
      warehouse: z.object({ id: z.string(), name: z.string(), code: z.string() }),
      batch: z.object({ id: z.string(), batchNumber: z.string(), manufacturingDate: z.string().nullable(), expiryDate: z.string().nullable() }).nullable(),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});
type ReportTab = "stock" | "expiry";

export function InventoryReports({ locale }: { locale: Locale }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const [tab, setTab] = useState<ReportTab>("stock");
  const [search, setSearch] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [before, setBefore] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const stockQuery = useQuery({
    queryKey: ["inventory-report", search, lowStock, page],
    enabled: tab === "stock",
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set("search", search);
      if (lowStock) params.set("lowStock", "true");
      const response = await fetch(`/api/inventory/reports/stock-summary?${params}`);
      if (!response.ok) throw new Error("Could not load the stock summary.");
      return summarySchema.parse(await response.json()).data;
    },
  });
  const expiryQuery = useQuery({
    queryKey: ["inventory-batch-expiry", before, page],
    enabled: tab === "expiry",
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (before) params.set("before", before);
      const response = await fetch(`/api/inventory/reports/batch-expiry?${params}`);
      if (!response.ok) throw new Error("Could not load batch expiry report.");
      return expirySchema.parse(await response.json()).data;
    },
  });
  const setReportTab = (next: ReportTab) => { setTab(next); setPage(1); };
  const pageCount = Math.max(1, Math.ceil(((tab === "stock" ? stockQuery.data?.total : expiryQuery.data?.total) ?? 0) / pageSize));
  const formatCurrency = (value: string) => new Intl.NumberFormat(locale === "HI" ? "hi-IN" : "en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value));
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">{copy("Inventory reports", "इन्वेंटरी रिपोर्ट")}</h1><p className="mt-2 text-sm text-slate-600">{copy("Review on-hand quantities, stock valuation, reorder alerts and batch expiry.", "उपलब्ध मात्रा, स्टॉक मूल्यांकन, पुनः-आदेश चेतावनी और बैच समाप्ति देखें।")}</p></header>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={copy("Inventory report type", "इन्वेंटरी रिपोर्ट प्रकार")}>
      <Button type="button" variant={tab === "stock" ? "default" : "secondary"} role="tab" aria-selected={tab === "stock"} onClick={() => setReportTab("stock")}>{copy("Stock summary", "स्टॉक सारांश")}</Button>
      <Button type="button" variant={tab === "expiry" ? "default" : "secondary"} role="tab" aria-selected={tab === "expiry"} onClick={() => setReportTab("expiry")}>{copy("Batch expiry", "बैच समाप्ति")}</Button>
    </div>
    {tab === "stock" && <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid min-w-64 flex-1 gap-1 text-sm">{copy("Search item, code, barcode or HSN", "आइटम, कोड, बारकोड या एचएसएन खोजें")}<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" checked={lowStock} onChange={(event) => { setLowStock(event.target.checked); setPage(1); }} />{copy("Reorder alerts only", "केवल पुनः-आदेश चेतावनी")}</label>
      </div>
      {stockQuery.isPending && <p role="status" className="py-8">{copy("Loading stock report…", "स्टॉक रिपोर्ट लोड हो रही है…")}</p>}
      {stockQuery.isError && <p role="alert" className="py-8 text-red-700">{stockQuery.error.message}</p>}
      {stockQuery.data && <>
        <div className="grid gap-3 sm:grid-cols-3"><article className="rounded-lg bg-slate-50 p-4"><p className="text-xs text-slate-500">{copy("On-hand quantity", "उपलब्ध मात्रा")}</p><p className="mt-1 text-xl font-semibold">{stockQuery.data.summary.totalQuantity}</p></article><article className="rounded-lg bg-slate-50 p-4"><p className="text-xs text-slate-500">{copy("Stock valuation", "स्टॉक मूल्यांकन")}</p><p className="mt-1 text-xl font-semibold">{formatCurrency(stockQuery.data.summary.totalValue)}</p></article><article className="rounded-lg bg-amber-50 p-4"><p className="text-xs text-amber-800">{copy("Items below reorder level", "पुनः-आदेश स्तर से कम आइटम")}</p><p className="mt-1 text-xl font-semibold text-amber-900">{stockQuery.data.summary.lowStockItems}</p></article></div>
        {stockQuery.data.rows.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{copy("No stock items match these filters.", "इन फ़िल्टर से कोई स्टॉक आइटम मेल नहीं खाता।")}</p>}
        {stockQuery.data.rows.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-3">{copy("Item", "आइटम")}</th><th className="p-3">{copy("Group", "समूह")}</th><th className="p-3">{copy("HSN / GST", "एचएसएन / जीएसटी")}</th><th className="p-3">{copy("On hand", "उपलब्ध")}</th><th className="p-3">{copy("Min / reorder / max", "न्यूनतम / पुनः-आदेश / अधिकतम")}</th><th className="p-3">{copy("Value", "मूल्य")}</th></tr></thead><tbody>{stockQuery.data.rows.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="p-3"><a href={`/dashboard/inventory/${item.id}`} className="font-medium text-blue-700 hover:underline">{item.name}</a><p className="text-xs text-slate-500">{item.code ?? "—"}</p></td><td className="p-3">{item.groupName}</td><td className="p-3">{item.hsnSac ?? "—"}<p className="text-xs text-slate-500">{item.gstRate}%</p></td><td className="p-3">{item.onHand} {item.unitSymbol}</td><td className="p-3">{item.minimumLevel} / {item.reorderLevel} / {item.maximumLevel ?? "—"}</td><td className="p-3">{formatCurrency(item.stockValue)}</td></tr>)}</tbody></table></div>}
      </>}
    </section>}
    {tab === "expiry" && <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <label className="grid max-w-xs gap-1 text-sm">{copy("Expiring on or before", "इस तिथि तक समाप्त होने वाले")}<Input type="date" value={before} onChange={(event) => { setBefore(event.target.value); setPage(1); }} /></label>
      {expiryQuery.isPending && <p role="status" className="py-8">{copy("Loading batch report…", "बैच रिपोर्ट लोड हो रही है…")}</p>}
      {expiryQuery.isError && <p role="alert" className="py-8 text-red-700">{expiryQuery.error.message}</p>}
      {expiryQuery.data && <>
        {expiryQuery.data.batches.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{copy("No positive batch balances match this date.", "इस तिथि से मेल खाते बैच शेष नहीं हैं।")}</p>}
        {expiryQuery.data.batches.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-3">{copy("Item", "आइटम")}</th><th className="p-3">{copy("Batch", "बैच")}</th><th className="p-3">{copy("Manufactured", "निर्मित")}</th><th className="p-3">{copy("Expiry", "समाप्ति")}</th><th className="p-3">{copy("Godown", "गोदाम")}</th><th className="p-3">{copy("Quantity", "मात्रा")}</th><th className="p-3">{copy("Value", "मूल्य")}</th></tr></thead><tbody>{expiryQuery.data.batches.map((balance) => <tr key={balance.id} className="border-b last:border-0"><td className="p-3"><a href={`/dashboard/inventory/${balance.item.id}`} className="font-medium text-blue-700 hover:underline">{balance.item.name}</a><p className="text-xs text-slate-500">{balance.item.code ?? balance.item.hsnSac ?? "—"}</p></td><td className="p-3">{balance.batch?.batchNumber ?? "—"}</td><td className="p-3">{balance.batch?.manufacturingDate ? new Date(balance.batch.manufacturingDate).toLocaleDateString(locale === "HI" ? "hi-IN" : "en-IN") : "—"}</td><td className="p-3">{balance.batch?.expiryDate ? new Date(balance.batch.expiryDate).toLocaleDateString(locale === "HI" ? "hi-IN" : "en-IN") : copy("No expiry", "समाप्ति नहीं")}</td><td className="p-3">{balance.warehouse.name}</td><td className="p-3">{balance.quantity} {balance.item.baseUnit.symbol}</td><td className="p-3">{formatCurrency(balance.value)}</td></tr>)}</tbody></table></div>}
      </>}
    </section>}
    <div className="flex items-center justify-between"><Button type="button" variant="secondary" disabled={page <= 1 || (tab === "stock" ? stockQuery.isPending : expiryQuery.isPending)} onClick={() => setPage((current) => Math.max(1, current - 1))}>{copy("Previous", "पिछला")}</Button><p aria-live="polite" className="text-sm text-slate-500">{copy("Page", "पृष्ठ")} {page} {copy("of", "में से")} {pageCount}</p><Button type="button" variant="secondary" disabled={page >= pageCount || (tab === "stock" ? stockQuery.isPending : expiryQuery.isPending)} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>{copy("Next", "अगला")}</Button></div>
  </div>;
}
