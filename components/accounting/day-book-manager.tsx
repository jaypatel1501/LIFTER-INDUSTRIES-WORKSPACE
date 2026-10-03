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
    entries: z.array(z.object({
      id: z.string(), voucherId: z.string(), eventType: z.string(), voucherType: z.string(),
      voucherNumber: z.string(), voucherDate: z.string(), narration: z.string().nullable(),
      createdAt: z.string(),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});
const eventLabels: Record<string, [string, string]> = {
  DRAFT_CREATED: ["Draft created", "मसौदा बनाया"],
  DRAFT_UPDATED: ["Draft updated", "मसौदा अपडेट"],
  APPROVAL_REQUESTED: ["Approval requested", "अनुमोदन अनुरोधित"],
  APPROVED: ["Approved", "अनुमोदित"],
  REJECTED: ["Rejected", "अस्वीकृत"],
  POSTED: ["Posted", "पोस्ट किया"],
  CANCELLED: ["Cancelled", "रद्द"],
  REVERSED: ["Reversed", "रिवर्स"],
};

export function DayBookManager({ locale }: { locale: Locale }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [event, setEvent] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["day-book", from, to, event, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (event) params.set("event", event);
      const response = await fetch(`/api/accounting/day-book?${params}`);
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? copy("Could not load Day Book.", "डे बुक लोड नहीं हो सकी।"));
      return responseSchema.parse(body).data;
    },
  });
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  const eventTypes = ["DRAFT_CREATED", "DRAFT_UPDATED", "APPROVAL_REQUESTED", "APPROVED", "REJECTED", "POSTED", "CANCELLED", "REVERSED"];
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">{copy("Day Book", "डे बुक")}</h1><p className="mt-2 text-sm text-slate-600">{copy("Immutable source history for draft, approval, posting, cancellation and reversal events.", "मसौदा, अनुमोदन, पोस्टिंग, रद्दीकरण और रिवर्सल की अपरिवर्तनीय स्रोत हिस्ट्री।")}</p></header>
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">{copy("From", "से")}<Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
        <label className="grid gap-1 text-sm">{copy("To", "तक")}<Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        <label className="grid gap-1 text-sm">{copy("Event", "घटना")}<select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={event} onChange={(e) => { setEvent(e.target.value); setPage(1); }}><option value="">{copy("All events", "सभी घटनाएँ")}</option>{eventTypes.map((value) => <option key={value} value={value}>{copy(value.replaceAll("_", " "), value)}</option>)}</select></label>
      </div>
      {query.isPending && <p role="status" className="py-8">{copy("Loading Day Book…", "डे बुक लोड हो रही है…")}</p>}
      {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
      {query.data?.entries.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No events match these filters.", "इन फ़िल्टर से कोई घटना नहीं मिली।")}</p>}
      {!!query.data?.entries.length && <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Date", "तिथि")}</th><th>{copy("Voucher", "वाउचर")}</th><th>{copy("Event", "घटना")}</th><th>{copy("Narration", "विवरण")}</th><th>{copy("Recorded", "दर्ज")}</th></tr></thead>
        <tbody className="divide-y">{query.data.entries.map((entry) => { const label = eventLabels[entry.eventType] ?? [entry.eventType, entry.eventType]; return <tr key={entry.id}><td className="py-3">{entry.voucherDate}</td><td><Link className="text-blue-700 hover:underline" href={`/dashboard/vouchers/${entry.voucherId}`}>{entry.voucherNumber}</Link><span className="ml-2 text-xs text-slate-500">{entry.voucherType}</span></td><td>{copy(label[0], label[1])}</td><td className="max-w-sm truncate">{entry.narration || "—"}</td><td>{new Date(entry.createdAt).toLocaleString(locale === "HI" ? "hi-IN" : "en-IN")}</td></tr>; })}</tbody>
      </table></div>}
      <div className="flex items-center justify-between border-t pt-3 text-sm"><span>{copy("Records", "रिकॉर्ड")}: {query.data?.total ?? 0}</span><div className="flex items-center gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button><span>{page} / {pages}</span><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button></div></div>
    </section>
  </div>;
}
