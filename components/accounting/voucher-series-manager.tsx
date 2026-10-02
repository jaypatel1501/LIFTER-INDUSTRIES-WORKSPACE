"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    numberSeries: z.array(z.object({
      id: z.string(), voucherType: z.string(), financialYearId: z.string().nullable(),
      prefix: z.string(), suffix: z.string(), nextNumber: z.number(), padding: z.number(),
      requiresApproval: z.boolean(), isActive: z.boolean(),
      financialYear: z.object({ id: z.string(), name: z.string(), status: z.string() }).nullable(),
    })),
    financialYears: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
  }),
});
const types = ["OPENING_BALANCE", "JOURNAL", "SALES", "PURCHASE", "PAYMENT", "RECEIPT", "CONTRA"];
const typeLabel: Record<string, [string, string]> = {
  OPENING_BALANCE: ["Opening balance", "प्रारंभिक शेष"], JOURNAL: ["Journal", "जर्नल"],
  SALES: ["Sales", "बिक्री"], PURCHASE: ["Purchase", "खरीद"], PAYMENT: ["Payment", "भुगतान"],
  RECEIPT: ["Receipt", "रसीद"], CONTRA: ["Contra", "कॉन्ट्रा"],
};
type SeriesEdit = {
  prefix: string;
  suffix: string;
  nextNumber: number;
  padding: number;
  requiresApproval: boolean;
  isActive: boolean;
};

export function VoucherSeriesManager({ locale }: { locale: Locale }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const client = useQueryClient();
  const [voucherType, setVoucherType] = useState("JOURNAL");
  const [financialYearId, setFinancialYearId] = useState("");
  const [prefix, setPrefix] = useState("JV-");
  const [suffix, setSuffix] = useState("");
  const [padding, setPadding] = useState(5);
  const [nextNumber, setNextNumber] = useState(1);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [edits, setEdits] = useState<Record<string, SeriesEdit>>({});
  const editFor = (series: z.infer<typeof responseSchema>["data"]["numberSeries"][number]): SeriesEdit =>
    edits[series.id] ?? {
      prefix: series.prefix, suffix: series.suffix, nextNumber: series.nextNumber,
      padding: series.padding, requiresApproval: series.requiresApproval, isActive: series.isActive,
    };
  const updateEdit = (series: z.infer<typeof responseSchema>["data"]["numberSeries"][number], field: keyof SeriesEdit, value: string | number | boolean) => {
    setEdits((current) => ({
      ...current,
      [series.id]: {
        ...(current[series.id] ?? {
          prefix: series.prefix, suffix: series.suffix, nextNumber: series.nextNumber,
          padding: series.padding, requiresApproval: series.requiresApproval, isActive: series.isActive,
        }),
        [field]: value,
      },
    }));
  };
  const query = useQuery({
    queryKey: ["voucher-series"],
    queryFn: async () => {
      const response = await fetch("/api/accounting/voucher-series");
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? copy("Could not load number series.", "नंबर श्रृंखला लोड नहीं हो सकी।"));
      return responseSchema.parse(body).data;
    },
  });
  const save = useMutation({
    mutationFn: async (input: { method: "POST" | "PATCH"; id?: string; body: unknown }) => {
      const response = await fetch(input.id ? `/api/accounting/voucher-series/${input.id}` : "/api/accounting/voucher-series", {
        method: input.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.body),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? copy("Could not save the number series.", "नंबर श्रृंखला सहेजी नहीं जा सकी।"));
      return body;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["voucher-series"] }),
  });
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">{copy("Voucher number series", "वाउचर नंबर श्रृंखला")}</h1><p className="mt-2 text-sm text-slate-600">{copy("Configure company- and financial-year-specific numbering and approval requirements. Issued numbers are never reused.", "कंपनी और वित्तीय वर्ष के अनुसार नंबरिंग तथा अनुमोदन सेट करें। जारी नंबर दोबारा उपयोग नहीं किए जा सकते।")}</p></header>
    <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-7" onSubmit={(event) => { event.preventDefault(); save.mutate({ method: "POST", body: { voucherType, financialYearId: financialYearId || null, prefix, suffix, nextNumber, padding, requiresApproval, isActive: true } }); }}>
      <label className="grid gap-1 text-sm">{copy("Voucher type", "वाउचर प्रकार")}<select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={voucherType} onChange={(event) => setVoucherType(event.target.value)}>{types.map((value) => { const label = typeLabel[value]!; return <option key={value} value={value}>{copy(label[0], label[1])}</option>; })}</select></label>
      <label className="grid gap-1 text-sm">{copy("Financial year", "वित्तीय वर्ष")}<select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={financialYearId} onChange={(event) => setFinancialYearId(event.target.value)}><option value="">{copy("Default series", "डिफ़ॉल्ट श्रृंखला")}</option>{query.data?.financialYears.map((year) => <option key={year.id} value={year.id}>{year.name} · {year.status}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{copy("Prefix", "उपसर्ग")}<Input value={prefix} onChange={(event) => setPrefix(event.target.value)} minLength={1} maxLength={32} pattern="[A-Za-z0-9/-]+" required /></label>
      <label className="grid gap-1 text-sm">{copy("Suffix", "प्रत्यय")}<Input value={suffix} onChange={(event) => setSuffix(event.target.value)} maxLength={16} pattern="[A-Za-z0-9/-]*" /></label>
      <label className="grid gap-1 text-sm">{copy("Starting number", "प्रारंभिक नंबर")}<Input type="number" min={1} max={2000000000} value={nextNumber} onChange={(event) => setNextNumber(Number(event.target.value))} /></label>
      <label className="grid gap-1 text-sm">{copy("Number padding", "नंबर लंबाई")}<Input type="number" min={1} max={12} value={padding} onChange={(event) => setPadding(Number(event.target.value))} /></label>
      <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={requiresApproval} onChange={(event) => setRequiresApproval(event.target.checked)} />{copy("Require approval", "अनुमोदन आवश्यक")}</label>
      <Button type="submit" className="self-end" disabled={save.isPending}>{copy("Create series", "श्रृंखला बनाएँ")}</Button>
      {save.isError && <p role="alert" className="text-sm text-red-700 sm:col-span-full">{save.error.message}</p>}
    </form>
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      {query.isPending && <p role="status" className="py-8">{copy("Loading series…", "श्रृंखला लोड हो रही है…")}</p>}
      {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
      {query.data?.numberSeries.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No series configured.", "कोई श्रृंखला कॉन्फ़िगर नहीं है।")}</p>}
      {!!query.data?.numberSeries.length && <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm">
        <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Voucher type", "वाउचर प्रकार")}</th><th>{copy("Period", "अवधि")}</th><th>{copy("Prefix", "उपसर्ग")}</th><th>{copy("Suffix", "प्रत्यय")}</th><th>{copy("Next", "अगला")}</th><th>{copy("Padding", "अंक")}</th><th>{copy("Approval", "अनुमोदन")}</th><th>{copy("Active", "सक्रिय")}</th><th>{copy("Save", "सहेजें")}</th></tr></thead>
        <tbody className="divide-y">{query.data.numberSeries.map((series) => {
          const edit = editFor(series);
          const label = typeLabel[series.voucherType] ?? [series.voucherType, series.voucherType];
          return <tr key={series.id}><td className="py-3">{copy(label[0], label[1])}</td><td>{series.financialYear?.name ?? copy("Default", "डिफ़ॉल्ट")}</td>
            <td><Input aria-label={`${series.voucherType} prefix`} value={edit.prefix} onChange={(event) => updateEdit(series, "prefix", event.target.value)} /></td>
            <td><Input aria-label={`${series.voucherType} suffix`} value={edit.suffix} onChange={(event) => updateEdit(series, "suffix", event.target.value)} /></td>
            <td><Input aria-label={`${series.voucherType} next number`} type="number" min={series.nextNumber} value={edit.nextNumber} onChange={(event) => updateEdit(series, "nextNumber", Number(event.target.value))} /></td>
            <td><Input aria-label={`${series.voucherType} padding`} type="number" min={1} max={12} value={edit.padding} onChange={(event) => updateEdit(series, "padding", Number(event.target.value))} /></td>
            <td><input type="checkbox" aria-label={`${series.voucherType} approval required`} checked={edit.requiresApproval} onChange={(event) => updateEdit(series, "requiresApproval", event.target.checked)} /></td>
            <td><input type="checkbox" aria-label={`${series.voucherType} series active`} checked={edit.isActive} onChange={(event) => updateEdit(series, "isActive", event.target.checked)} /></td>
            <td><Button size="sm" variant="secondary" disabled={save.isPending || edit.nextNumber < series.nextNumber} onClick={() => save.mutate({ method: "PATCH", id: series.id, body: edit })}>{copy("Save", "सहेजें")}</Button></td></tr>;
        })}</tbody>
      </table></div>}
    </section>
  </div>;
}
