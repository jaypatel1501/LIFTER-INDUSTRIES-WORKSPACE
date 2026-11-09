"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import {
  gstAdjustmentSchema,
  gstRegistrationSchema,
  hsnSacValidationSchema,
} from "@/lib/validation/gst";

const responseErrorSchema = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
});
const registrationResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    registration: z.object({
      gstin: z.string(),
      legalName: z.string(),
      tradeName: z.string().nullable(),
      stateCode: z.string(),
      registrationType: z.enum(["REGULAR", "COMPOSITION", "SEZ", "ISD", "TDS", "TCS", "UNREGISTERED"]),
      effectiveFrom: z.string(),
      filingFrequency: z.string(),
      adapterMode: z.enum(["SANDBOX", "LIVE"]),
      isActive: z.boolean(),
    }).nullable(),
  }),
});
const reportResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    report: z.string(),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    invoices: z.array(z.record(z.string(), z.unknown())).optional(),
    total: z.number().optional(),
    page: z.number().optional(),
    pageSize: z.number().optional(),
    summary: z.record(z.string(), z.unknown()).optional(),
    creditDebitNotes: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
});
const uploadsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    uploads: z.array(z.object({
      id: z.string(),
      periodKey: z.string(),
      fileName: z.string(),
      status: z.string(),
      rowCount: z.number(),
      matchedCount: z.number(),
      mismatchCount: z.number(),
      missingCount: z.number(),
      createdAt: z.string(),
    })),
  }),
});
const adjustmentsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    adjustments: z.array(z.object({
      id: z.string(),
      periodKey: z.string(),
      adjustmentType: z.string(),
      side: z.string(),
      noteNumber: z.string(),
      noteDate: z.string(),
      taxableAmount: z.string(),
      reason: z.string(),
    })),
  }),
});

const reportNames = [
  "SALES_REGISTER", "PURCHASE_REGISTER", "GSTR1", "GSTR3B", "GST_LEDGER", "MISMATCHES",
] as const;
type ReportName = (typeof reportNames)[number];
type RegistrationInput = z.output<typeof gstRegistrationSchema>;
type AdjustmentInput = z.output<typeof gstAdjustmentSchema>;

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = responseErrorSchema.safeParse(body).data?.error?.message;
    throw new Error(message ?? "Request could not be completed");
  }
  return body;
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export function GSTManager({ locale }: { locale: Locale }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const queryClient = useQueryClient();
  const [periodKey, setPeriodKey] = useState(currentPeriod);
  const [report, setReport] = useState<ReportName>("SALES_REGISTER");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [periodReason, setPeriodReason] = useState("GST return period finalized");
  const [code, setCode] = useState("");
  const [codeKind, setCodeKind] = useState<"HSN" | "SAC">("HSN");
  const [codeResult, setCodeResult] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const registrationQuery = useQuery({
    queryKey: ["gst-registration"],
    queryFn: async () => registrationResponseSchema.parse(await requestJson("/api/gst/registration")).data.registration,
  });
  const reportQuery = useQuery({
    queryKey: ["gst-report", report, periodKey, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        report, periodKey, search, page: String(page), pageSize: "25",
      });
      return reportResponseSchema.parse(await requestJson(`/api/gst/reports?${params}`)).data;
    },
  });
  const periodQuery = useQuery({
    queryKey: ["gst-period", periodKey],
    queryFn: async () => {
      const response = await requestJson(`/api/gst/periods?periodKey=${encodeURIComponent(periodKey)}`);
      const parsed = z.object({
        success: z.literal(true),
        data: z.object({ period: z.object({ isLocked: z.boolean(), lockReason: z.string().nullable() }).nullable() }),
      }).parse(response);
      return parsed.data.period;
    },
  });
  const uploadsQuery = useQuery({
    queryKey: ["gst-2b-uploads", periodKey],
    queryFn: async () => uploadsResponseSchema.parse(await requestJson(`/api/gst/reconciliation?periodKey=${encodeURIComponent(periodKey)}`)).data.uploads,
  });
  const adjustmentsQuery = useQuery({
    queryKey: ["gst-adjustments", periodKey],
    queryFn: async () => adjustmentsResponseSchema.parse(await requestJson(`/api/gst/adjustments?periodKey=${encodeURIComponent(periodKey)}`)).data.adjustments,
  });

  const registrationForm = useForm<z.input<typeof gstRegistrationSchema>, unknown, RegistrationInput>({
    resolver: zodResolver(gstRegistrationSchema),
    defaultValues: {
      gstin: "", legalName: "", tradeName: "", stateCode: "",
      registrationType: "REGULAR", effectiveFrom: new Date().toISOString().slice(0, 10),
      filingFrequency: "MONTHLY", adapterMode: "SANDBOX", isActive: true,
    },
  });
  useEffect(() => {
    const registration = registrationQuery.data;
    if (registration) registrationForm.reset({
      ...registration,
      effectiveFrom: registration.effectiveFrom.slice(0, 10),
      tradeName: registration.tradeName ?? "",
      filingFrequency: registration.filingFrequency === "QUARTERLY" ? "QUARTERLY" : "MONTHLY",
    });
  }, [registrationQuery.data, registrationForm]);

  const saveRegistration = useMutation({
    mutationFn: async (input: RegistrationInput) => requestJson("/api/gst/registration", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }),
    onSuccess: async () => {
      setNotice(copy("GST registration saved.", "GST पंजीकरण सहेजा गया।"));
      await queryClient.invalidateQueries({ queryKey: ["gst-registration"] });
    },
    onError: (error) => setNotice(error.message),
  });

  const periodMutation = useMutation({
    mutationFn: async (action: "LOCK" | "UNLOCK") => requestJson("/api/gst/periods", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ periodKey, action, reason: periodReason }),
    }),
    onSuccess: async () => {
      setNotice(copy("GST period status updated.", "GST अवधि की स्थिति अपडेट हुई।"));
      await queryClient.invalidateQueries({ queryKey: ["gst-period", periodKey] });
    },
    onError: (error) => setNotice(error.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error(copy("Choose a CSV or JSON file first.", "पहले CSV या JSON फ़ाइल चुनें।"));
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("periodKey", periodKey);
      return requestJson("/api/gst/reconciliation", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: form,
      });
    },
    onSuccess: async () => {
      setUploadFile(null);
      setNotice(copy("GSTR-2B file uploaded and reconciled.", "GSTR-2B फ़ाइल अपलोड और मिलान की गई।"));
      await queryClient.invalidateQueries({ queryKey: ["gst-2b-uploads", periodKey] });
      await queryClient.invalidateQueries({ queryKey: ["gst-report", "MISMATCHES", periodKey] });
    },
    onError: (error) => setNotice(error.message),
  });

  const adjustmentForm = useForm<z.input<typeof gstAdjustmentSchema>, unknown, AdjustmentInput>({
    resolver: zodResolver(gstAdjustmentSchema),
    defaultValues: {
      periodKey, adjustmentType: "CREDIT_NOTE", side: "SALES", voucherNumber: "", noteNumber: "",
      noteDate: `${periodKey}-01`, counterpartyGstin: "", taxableAmount: "0",
      cgstAmount: "0", sgstAmount: "0", utgstAmount: "0", igstAmount: "0",
      cessAmount: "0", reason: "",
    },
  });
  useEffect(() => {
    adjustmentForm.setValue("periodKey", periodKey);
    adjustmentForm.setValue("noteDate", `${periodKey}-01`);
  }, [periodKey, adjustmentForm]);
  const createAdjustment = useMutation({
    mutationFn: async (input: AdjustmentInput) => requestJson("/api/gst/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(input),
    }),
    onSuccess: async () => {
      adjustmentForm.reset({
        periodKey, adjustmentType: "CREDIT_NOTE", side: "SALES", voucherNumber: "", noteNumber: "",
        noteDate: `${periodKey}-01`, counterpartyGstin: "", taxableAmount: "0",
        cgstAmount: "0", sgstAmount: "0", utgstAmount: "0", igstAmount: "0",
        cessAmount: "0", reason: "",
      });
      setNotice(copy("GST note adjustment recorded.", "GST नोट समायोजन दर्ज किया गया।"));
      await queryClient.invalidateQueries({ queryKey: ["gst-adjustments", periodKey] });
      await queryClient.invalidateQueries({ queryKey: ["gst-report", "GSTR1", periodKey] });
      await queryClient.invalidateQueries({ queryKey: ["gst-report", "GSTR3B", periodKey] });
    },
    onError: (error) => setNotice(error.message),
  });

  const reportRows = reportQuery.data?.rows ?? reportQuery.data?.invoices ??
    (reportQuery.data?.summary ? [reportQuery.data.summary] : []);
  const total = reportQuery.data?.total ?? reportRows.length;
  const pageCount = Math.max(1, Math.ceil(total / 25));
  const params = new URLSearchParams({ report, periodKey, search, page: String(page), pageSize: "25", format: "csv" });
  const submitRegistration = registrationForm.handleSubmit((value) => saveRegistration.mutate(value));
  const submitAdjustment = adjustmentForm.handleSubmit((value) => createAdjustment.mutate(value));

  return <div className="space-y-6">
    <header>
      <h1 className="text-2xl font-semibold">{copy("GST compliance", "GST अनुपालन")}</h1>
      <p className="mt-2 text-sm text-slate-600">{copy("Manage registration, tax datasets, 2B reconciliation, note adjustments, and return period locks.", "पंजीकरण, कर डेटा, 2B मिलान, नोट समायोजन और रिटर्न अवधि लॉक प्रबंधित करें।")}</p>
    </header>
    {notice && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}

    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">{copy("GST registration", "GST पंजीकरण")}</h2>
      {registrationQuery.isPending && <p role="status" className="mt-3 text-sm">{copy("Loading registration…", "पंजीकरण लोड हो रहा है…")}</p>}
      {registrationQuery.isError && <p role="alert" className="mt-3 text-sm text-red-700">{registrationQuery.error.message}</p>}
      <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => { void submitRegistration(event); }}>
        <label className="grid gap-1 text-sm">GSTIN<Input {...registrationForm.register("gstin")} /></label>
        <label className="grid gap-1 text-sm">{copy("State code", "राज्य कोड")}<Input {...registrationForm.register("stateCode")} /></label>
        <label className="grid gap-1 text-sm">{copy("Legal name", "कानूनी नाम")}<Input {...registrationForm.register("legalName")} /></label>
        <label className="grid gap-1 text-sm">{copy("Trade name", "व्यापार नाम")}<Input {...registrationForm.register("tradeName")} /></label>
        <label className="grid gap-1 text-sm">{copy("Effective from", "प्रभावी तिथि")}<Input type="date" {...registrationForm.register("effectiveFrom")} /></label>
        <label className="grid gap-1 text-sm">{copy("Registration type", "पंजीकरण प्रकार")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...registrationForm.register("registrationType")}><option value="REGULAR">Regular</option><option value="COMPOSITION">Composition</option><option value="SEZ">SEZ</option><option value="ISD">ISD</option><option value="TDS">TDS</option><option value="TCS">TCS</option><option value="UNREGISTERED">Unregistered</option></select></label>
        <label className="grid gap-1 text-sm">{copy("Filing frequency", "फाइलिंग आवृत्ति")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...registrationForm.register("filingFrequency")}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></select></label>
        <label className="grid gap-1 text-sm">{copy("Portal adapter mode", "पोर्टल एडाप्टर मोड")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...registrationForm.register("adapterMode")}><option value="SANDBOX">Sandbox</option><option value="LIVE">Live</option></select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...registrationForm.register("isActive")} />{copy("Registration active", "पंजीकरण सक्रिय")}</label>
        <p className="text-sm text-slate-600 md:col-span-2">{copy("The adapter mode is saved as configuration only; this module does not submit data to an external GST portal.", "एडाप्टर मोड केवल कॉन्फ़िगरेशन के रूप में सहेजा जाता है; यह मॉड्यूल बाहरी GST पोर्टल पर डेटा जमा नहीं करता।")}</p>
        <div className="md:col-span-2">
          {Object.values(registrationForm.formState.errors).map((error, index) => <p key={index} className="text-sm text-red-700">{error.message}</p>)}
          <Button type="submit" className="mt-2" disabled={saveRegistration.isPending}>{saveRegistration.isPending ? copy("Saving…", "सहेज रहे हैं…") : copy("Save registration", "पंजीकरण सहेजें")}</Button>
        </div>
      </form>
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">{copy("GST reports and exports", "GST रिपोर्ट और निर्यात")}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm">{copy("Return period", "रिटर्न अवधि")}<Input type="month" value={periodKey} onChange={(event) => { setPeriodKey(event.target.value); setPage(1); }} /></label>
        <label className="grid gap-1 text-sm">{copy("Dataset", "डेटासेट")}<select className="h-11 rounded-lg border border-slate-300 px-3" value={report} onChange={(event) => { setReport(event.target.value as ReportName); setPage(1); }}>{reportNames.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">{copy("Search", "खोजें")}<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <div className="flex items-end"><a className="inline-flex h-11 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50" href={`/api/gst/reports?${params}`}>{copy("Export filtered period CSV", "फ़िल्टर की गई अवधि CSV निर्यात")}</a></div>
      </div>
      {reportQuery.isPending && <p role="status" className="py-8">{copy("Loading GST dataset…", "GST डेटा लोड हो रहा है…")}</p>}
      {reportQuery.isError && <p role="alert" className="py-8 text-red-700">{reportQuery.error.message}</p>}
      {!reportQuery.isPending && !reportQuery.isError && reportRows.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No records match this period and filter.", "इस अवधि और फ़िल्टर से कोई रिकॉर्ड नहीं मिला।")}</p>}
      {!!reportRows.length && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Document", "दस्तावेज़")}</th><th>{copy("Date", "तिथि")}</th><th>{copy("Counterparty", "पार्टी")}</th><th className="text-right">{copy("Taxable", "कर योग्य")}</th><th className="text-right">{copy("Total", "कुल")}</th><th>{copy("Status / details", "स्थिति / विवरण")}</th></tr></thead>
        <tbody className="divide-y">{reportRows.map((row, index) => <tr key={`${String(row.documentNumber ?? row.invoiceNumber ?? row.noteNumber ?? index)}-${index}`}><td className="py-3">{String(row.documentNumber ?? row.invoiceNumber ?? row.noteNumber ?? report)}</td><td>{String(row.documentDate ?? row.noteDate ?? "")}</td><td>{String(row.customer ?? row.supplier ?? row.customerGstin ?? row.supplierGstin ?? "")}</td><td className="text-right">{String(row.taxableAmount ?? row.outwardTaxableValue ?? "")}</td><td className="text-right">{String(row.totalAmount ?? "")}</td><td className="max-w-sm truncate">{String(row.status ?? JSON.stringify(row.outputTax ?? row))}</td></tr>)}</tbody>
      </table></div>}
      {reportQuery.data && <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm"><span>{copy("Records", "रिकॉर्ड")}: {total}</span><div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button><span>{page} / {pageCount}</span><Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button></div></div>}
    </section>

    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("GSTR-2B reconciliation upload", "GSTR-2B मिलान अपलोड")}</h2>
        <p className="text-sm text-slate-600">{copy("Upload normalized CSV or JSON with invoiceNumber, supplierGstin, invoiceDate, taxableAmount, and GST component amount fields. Files are stored privately in Vercel Blob.", "invoiceNumber, supplierGstin, invoiceDate, taxableAmount और GST घटक राशि वाले CSV या JSON अपलोड करें। फ़ाइलें Vercel Blob में निजी रूप से रखी जाती हैं।")}</p>
        <div className="flex flex-wrap items-center gap-3"><Input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} /><Button disabled={!uploadFile || uploadMutation.isPending || periodQuery.data?.isLocked} onClick={() => uploadMutation.mutate()}>{uploadMutation.isPending ? copy("Reconciling…", "मिलान हो रहा है…") : copy("Upload and reconcile", "अपलोड और मिलान")}</Button></div>
        {uploadsQuery.isPending && <p role="status" className="text-sm">{copy("Loading uploads…", "अपलोड लोड हो रहे हैं…")}</p>}
        {uploadsQuery.isError && <p role="alert" className="text-sm text-red-700">{uploadsQuery.error.message}</p>}
        {uploadsQuery.data?.length === 0 && <p className="text-sm text-slate-500">{copy("No GSTR-2B uploads for this period.", "इस अवधि के लिए कोई GSTR-2B अपलोड नहीं है।")}</p>}
        {!!uploadsQuery.data?.length && <ul className="space-y-2 text-sm">{uploadsQuery.data.map((upload) => <li key={upload.id} className="rounded-lg bg-slate-50 p-3">{upload.fileName} · {upload.rowCount} {copy("rows", "पंक्तियाँ")} · {upload.matchedCount} {copy("matched", "मिले")} · {upload.mismatchCount} {copy("mismatched", "असंगत")} · {upload.missingCount} {copy("missing", "गायब")}</li>)}</ul>}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Return-period locking", "रिटर्न अवधि लॉक")}</h2>
        <p className="text-sm text-slate-600">{periodQuery.data?.isLocked ? copy(`Locked: ${periodQuery.data.lockReason ?? "No reason recorded"}`, `लॉक है: ${periodQuery.data.lockReason ?? "कारण दर्ज नहीं"}`) : copy("This period is open for GST adjustments.", "यह अवधि GST समायोजन के लिए खुली है।")}</p>
        {periodQuery.isPending && <p role="status" className="text-sm">{copy("Checking period status…", "अवधि स्थिति जाँची जा रही है…")}</p>}
        {periodQuery.isError && <p role="alert" className="text-sm text-red-700">{periodQuery.error.message}</p>}
        <label className="grid gap-1 text-sm">{copy("Audit reason", "ऑडिट कारण")}<Input value={periodReason} onChange={(event) => setPeriodReason(event.target.value)} minLength={5} maxLength={500} /></label>
        <Button disabled={periodMutation.isPending || periodQuery.isPending || periodReason.trim().length < 5} variant={periodQuery.data?.isLocked ? "secondary" : "default"} onClick={() => { periodMutation.mutate(periodQuery.data?.isLocked ? "UNLOCK" : "LOCK"); }}>{periodQuery.data?.isLocked ? copy("Unlock period", "अवधि अनलॉक करें") : copy("Lock period", "अवधि लॉक करें")}</Button>
      </section>
    </div>

    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Credit / debit note adjustments", "क्रेडिट / डेबिट नोट समायोजन")}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { void submitAdjustment(event); }}>
          <label className="grid gap-1 text-sm">{copy("Note type", "नोट प्रकार")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...adjustmentForm.register("adjustmentType")}><option value="CREDIT_NOTE">Credit note</option><option value="DEBIT_NOTE">Debit note</option></select></label>
          <label className="grid gap-1 text-sm">{copy("Side", "पक्ष")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...adjustmentForm.register("side")}><option value="SALES">Sales</option><option value="PURCHASE">Purchase</option></select></label>
          <label className="grid gap-1 text-sm">{copy("Note number", "नोट नंबर")}<Input {...adjustmentForm.register("noteNumber")} /></label>
          <label className="grid gap-1 text-sm">{copy("Posted voucher number", "पोस्ट किया वाउचर नंबर")}<Input {...adjustmentForm.register("voucherNumber")} /></label>
          <label className="grid gap-1 text-sm">{copy("Date", "तिथि")}<Input type="date" {...adjustmentForm.register("noteDate")} /></label>
          <label className="grid gap-1 text-sm">{copy("Counterparty GSTIN", "पार्टी GSTIN")}<Input {...adjustmentForm.register("counterpartyGstin")} /></label>
          <label className="grid gap-1 text-sm">{copy("Taxable amount", "कर योग्य राशि")}<Input inputMode="decimal" {...adjustmentForm.register("taxableAmount")} /></label>
          {(["cgstAmount", "sgstAmount", "utgstAmount", "igstAmount", "cessAmount"] as const).map((field) => <label key={field} className="grid gap-1 text-sm">{field}<Input inputMode="decimal" {...adjustmentForm.register(field)} /></label>)}
          <label className="grid gap-1 text-sm sm:col-span-2">{copy("Reason", "कारण")}<Input {...adjustmentForm.register("reason")} /></label>
          <div className="sm:col-span-2">{Object.values(adjustmentForm.formState.errors).map((error, index) => <p key={index} className="text-sm text-red-700">{error.message}</p>)}<Button className="mt-2" disabled={createAdjustment.isPending || periodQuery.data?.isLocked}>{copy("Record adjustment", "समायोजन दर्ज करें")}</Button></div>
        </form>
        {adjustmentsQuery.isPending && <p role="status" className="mt-3 text-sm">{copy("Loading adjustments…", "समायोजन लोड हो रहे हैं…")}</p>}
        {adjustmentsQuery.isError && <p role="alert" className="mt-3 text-sm text-red-700">{adjustmentsQuery.error.message}</p>}
        {adjustmentsQuery.data?.length === 0 && <p className="mt-3 text-sm text-slate-500">{copy("No note adjustments in this period.", "इस अवधि में कोई नोट समायोजन नहीं।")}</p>}
        {!!adjustmentsQuery.data?.length && <ul className="mt-3 space-y-2 text-sm">{adjustmentsQuery.data.map((adjustment) => <li key={adjustment.id} className="rounded-lg bg-slate-50 p-3">{adjustment.noteNumber} · {adjustment.adjustmentType} · {adjustment.side} · {adjustment.taxableAmount}</li>)}</ul>}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("HSN / SAC validator", "HSN / SAC सत्यापन")}</h2>
        <div className="flex gap-2"><select aria-label="Code type" className="h-11 rounded-lg border border-slate-300 px-3" value={codeKind} onChange={(event) => setCodeKind(event.target.value as "HSN" | "SAC")}><option>HSN</option><option>SAC</option></select><Input aria-label="HSN or SAC code" value={code} onChange={(event) => setCode(event.target.value)} /><Button type="button" variant="secondary" onClick={() => { const result = hsnSacValidationSchema.safeParse({ code, kind: codeKind }); setCodeResult(result.success ? copy("Code format is valid.", "कोड प्रारूप मान्य है।") : result.error.issues[0]?.message ?? copy("Invalid code.", "अमान्य कोड।")); }}>{copy("Validate", "सत्यापित करें")}</Button></div>
        {codeResult && <p role="status" className="text-sm">{codeResult}</p>}
      </section>
    </div>
  </div>;
}
