"use client";

import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { z } from "zod";

const registerSchema = z.object({ success: z.literal(true), data: z.object({ report: z.literal("register"),
  documents: z.array(z.object({ id: z.string(), documentNumber: z.string(), documentType: z.string(), status: z.string(), documentDate: z.string(),
    supplierInvoiceNumber: z.string().nullable(), supplierInvoiceDate: z.string().nullable(), taxableAmount: z.string(), cgstAmount: z.string(), sgstAmount: z.string(),
    utgstAmount: z.string(), igstAmount: z.string(), totalAmount: z.string(), party: z.object({ id: z.string(), name: z.string() }), voucher: z.object({ voucherNumber: z.string() }).nullable() })),
  total: z.number(), page: z.number(), pageSize: z.number(), totals: z.record(z.string(), z.string()),
}) });
const analysisSchema = z.object({ success: z.literal(true), data: z.object({ report: z.literal("analysis"),
  suppliers: z.array(z.object({ id: z.string(), name: z.string(), invoiceCount: z.number(), purchaseAmount: z.string(), returnAmount: z.string(), netAmount: z.string() })),
  items: z.array(z.object({ id: z.string(), name: z.string(), code: z.string().nullable(), quantity: z.string(), purchaseAmount: z.string() })),
}) });

export function PurchaseReports({ locale }: { locale: Locale }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const [report, setReport] = useState<"register" | "analysis">("register");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["purchase-report", report, search, from, to, page], queryFn: async () => {
    const params = new URLSearchParams({ report, page: String(page), pageSize: "25" });
    if (search) params.set("search", search);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const response = await fetch(`/api/purchases/reports?${params}`);
    if (!response.ok) throw new Error("Could not load purchase reports.");
    const result: unknown = await response.json();
    return report === "register" ? registerSchema.parse(result).data : analysisSchema.parse(result).data;
  } });
  const data = query.data;
  const money = (value: string) => new Intl.NumberFormat(locale === "HI" ? "hi-IN" : "en-IN", { style: "currency", currency: "INR" }).format(Number(value));
  const pageCount = data?.report === "register" ? Math.max(1, Math.ceil(data.total / 25)) : 1;

  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold">{copy("Purchase reports", "खरीद रिपोर्ट")}</h1></header>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex gap-1" role="tablist" aria-label={copy("Purchase report", "खरीद रिपोर्ट")}>
          <Button role="tab" aria-selected={report === "register"} variant={report === "register" ? "default" : "secondary"} onClick={() => { setReport("register"); setPage(1); }}>{copy("Purchase register", "खरीद रजिस्टर")}</Button>
          <Button role="tab" aria-selected={report === "analysis"} variant={report === "analysis" ? "default" : "secondary"} onClick={() => { setReport("analysis"); setPage(1); }}>{copy("Analysis", "विश्लेषण")}</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label={copy("Search documents or suppliers", "दस्तावेज़ या आपूर्तिकर्ता खोजें")} placeholder={copy("Document, invoice or supplier", "दस्तावेज़, इनवॉइस या आपूर्तिकर्ता")} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <label className="grid gap-1 text-xs text-slate-600">{copy("From", "से")}<Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
          <label className="grid gap-1 text-xs text-slate-600">{copy("To", "तक")}<Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
        </div>
      </div>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      {query.isLoading ? <p className="text-sm text-slate-600">{copy("Loading report…", "रिपोर्ट लोड हो रही है…")}</p>
        : query.isError ? <p role="alert" className="text-sm text-red-700">{query.error.message}</p>
          : data?.report === "register" ? !data.documents.length ? <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-600">{copy("No posted purchase invoices or returns match these filters.", "इन फ़िल्टरों से कोई पोस्ट किया खरीद इनवॉइस या वापसी नहीं मिली।")}</p>
            : <><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-3 pr-3">{copy("Document", "दस्तावेज़")}</th><th className="py-3 pr-3">{copy("Date", "तारीख")}</th><th className="py-3 pr-3">{copy("Supplier", "आपूर्तिकर्ता")}</th><th className="py-3 pr-3">{copy("Supplier ref.", "आपूर्तिकर्ता संदर्भ")}</th><th className="py-3 pr-3">{copy("Taxable", "कर योग्य")}</th><th className="py-3 pr-3">{copy("GST", "जीएसटी")}</th><th className="py-3 pr-3">{copy("Total", "कुल")}</th><th className="py-3">{copy("Voucher", "वाउचर")}</th></tr></thead><tbody>
              {data.documents.map((doc) => <tr key={doc.id} className="border-b last:border-0"><td className="py-3 pr-3"><span className="font-medium">{doc.documentNumber}</span><span className="block text-xs text-slate-500">{doc.documentType.replaceAll("_", " ")}</span></td><td className="py-3 pr-3">{new Date(doc.documentDate).toLocaleDateString(locale === "HI" ? "hi-IN" : "en-IN")}</td><td className="py-3 pr-3">{doc.party.name}</td><td className="py-3 pr-3">{doc.supplierInvoiceNumber ?? "—"}</td><td className="py-3 pr-3">{money(doc.taxableAmount)}</td><td className="py-3 pr-3">{money((Number(doc.cgstAmount) + Number(doc.sgstAmount) + Number(doc.utgstAmount) + Number(doc.igstAmount)).toFixed(2))}</td><td className="py-3 pr-3">{money(doc.totalAmount)}</td><td className="py-3">{doc.voucher?.voucherNumber ?? "—"}</td></tr>)}
            </tbody></table></div><div className="mt-4 flex items-center justify-between text-sm"><span>{copy(`Page ${page} of ${pageCount} · ${data.total} documents`, `पृष्ठ ${page}/${pageCount} · ${data.total} दस्तावेज़`)}</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button><Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button></div></div></>
            : data?.report === "analysis" ? <div className="grid gap-8 xl:grid-cols-2">
              <div><h2 className="mb-3 font-semibold">{copy("Supplier spend (net of returns)", "वापसी के बाद आपूर्तिकर्ता खरीद")}</h2>{data.suppliers.length ? <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2">{copy("Supplier", "आपूर्तिकर्ता")}</th><th className="py-2">{copy("Invoices", "इनवॉइस")}</th><th className="py-2 text-right">{copy("Net amount", "शुद्ध राशि")}</th></tr></thead><tbody>{data.suppliers.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="py-3">{row.name}</td><td className="py-3">{row.invoiceCount}</td><td className="py-3 text-right">{money(row.netAmount)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-600">{copy("No supplier purchases in this period.", "इस अवधि में कोई आपूर्तिकर्ता खरीद नहीं।")}</p>}</div>
              <div><h2 className="mb-3 font-semibold">{copy("Item purchases (net of returns)", "वापसी के बाद आइटम खरीद")}</h2>{data.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-2">{copy("Item", "आइटम")}</th><th className="py-2">{copy("Net qty", "शुद्ध मात्रा")}</th><th className="py-2 text-right">{copy("Net amount", "शुद्ध राशि")}</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="py-3">{row.name}{row.code ? <span className="ml-2 text-xs text-slate-500">{row.code}</span> : null}</td><td className="py-3">{row.quantity}</td><td className="py-3 text-right">{money(row.purchaseAmount)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-600">{copy("No item purchases in this period.", "इस अवधि में कोई आइटम खरीद नहीं।")}</p>}</div>
            </div> : null}
    </section>
  </div>;
}
