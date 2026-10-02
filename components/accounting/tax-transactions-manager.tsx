"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    transactions: z.array(z.object({
      id: z.string(), voucherId: z.string(), taxType: z.string(),
      taxableAmount: z.string(), taxAmount: z.string(), rate: z.string(),
      transactionDate: z.string(), isReversal: z.boolean(),
      ledger: z.object({ id: z.string(), name: z.string(), code: z.string().nullable() }),
      voucher: z.object({ id: z.string(), voucherNumber: z.string(), type: z.string(), status: z.string() }),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});
const taxTypes = ["CGST", "SGST", "IGST", "CESS", "TDS", "TCS", "OTHER"];

export function TaxTransactionsManager({ locale }: { locale: Locale }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const [taxType, setTaxType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["tax-transactions", taxType, from, to, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (taxType) params.set("taxType", taxType);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/accounting/tax-transactions?${params}`);
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? copy("Could not load tax transactions.", "कर लेनदेन लोड नहीं हो सके।"));
      return responseSchema.parse(body).data;
    },
  });
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">{copy("Tax transactions", "कर लेनदेन")}</h1><p className="mt-2 text-sm text-slate-600">{copy("Posted tax details are recorded atomically with their vouchers. Reversal rows remain identifiable for reconciliation.", "पोस्ट किए कर विवरण वाउचर के साथ परमाणु रूप से दर्ज होते हैं। मिलान के लिए रिवर्सल पंक्तियाँ अलग पहचानी जा सकती हैं।")}</p></header>
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">{copy("Tax type", "कर प्रकार")}<select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={taxType} onChange={(event) => { setTaxType(event.target.value); setPage(1); }}><option value="">{copy("All tax types", "सभी कर प्रकार")}</option>{taxTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="grid gap-1 text-sm">{copy("From", "से")}<Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
        <label className="grid gap-1 text-sm">{copy("To", "तक")}<Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
      </div>
      {query.isPending && <p role="status" className="py-8">{copy("Loading tax transactions…", "कर लेनदेन लोड हो रहे हैं…")}</p>}
      {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
      {query.data?.transactions.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No tax transactions match these filters.", "इन फ़िल्टर से कोई कर लेनदेन नहीं मिला।")}</p>}
      {!!query.data?.transactions.length && <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Date", "तिथि")}</th><th>{copy("Voucher", "वाउचर")}</th><th>{copy("Tax type", "कर प्रकार")}</th><th>{copy("Tax ledger", "कर खाता")}</th><th className="text-right">{copy("Taxable", "कर योग्य")}</th><th className="text-right">{copy("Rate", "दर")}</th><th className="text-right">{copy("Tax", "कर")}</th><th>{copy("Reversal", "रिवर्सल")}</th></tr></thead>
        <tbody className="divide-y">{query.data.transactions.map((transaction) => <tr key={transaction.id}><td className="py-3">{transaction.transactionDate}</td><td><Link className="text-blue-700 hover:underline" href={`/dashboard/vouchers/${transaction.voucher.id}`}>{transaction.voucher.voucherNumber}</Link></td><td>{transaction.taxType}</td><td>{transaction.ledger.name}</td><td className="text-right">{transaction.taxableAmount}</td><td className="text-right">{transaction.rate}%</td><td className="text-right">{transaction.taxAmount}</td><td>{transaction.isReversal ? copy("Yes", "हाँ") : copy("No", "नहीं")}</td></tr>)}</tbody>
      </table></div>}
      <div className="flex items-center justify-between border-t pt-3 text-sm"><span>{copy("Records", "रिकॉर्ड")}: {query.data?.total ?? 0}</span><div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{copy("Previous", "पिछला")}</Button><span>{page} / {pageCount}</span><Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>{copy("Next", "अगला")}</Button></div></div>
    </section>
  </div>;
}
