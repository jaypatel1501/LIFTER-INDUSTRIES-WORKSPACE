"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { voucherDraftSchema } from "@/lib/validation/vouchers";
import { managementCopy } from "@/lib/management-copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const optionsSchema = z.object({
  success: z.literal(true),
  data: z.object({
    ledgers: z.array(z.object({ id: z.string(), name: z.string(), code: z.string().nullable() })),
    costCentres: z.array(z.object({ id: z.string(), name: z.string(), code: z.string() })),
    stockItems: z.array(z.object({ id: z.string(), name: z.string(), code: z.string().nullable(), batchTracked: z.boolean(), baseUnit: z.object({ symbol: z.string() }) })),
    warehouses: z.array(z.object({ id: z.string(), name: z.string(), code: z.string() })),
  }),
});
const listSchema = z.object({
  success: z.literal(true),
  data: z.object({
    vouchers: z.array(z.object({
      id: z.string(), voucherNumber: z.string(), type: z.string(), status: z.string(),
      approvalStatus: z.string(), voucherDate: z.string(), narration: z.string().nullable(),
      debitTotal: z.string(), creditTotal: z.string(), lineCount: z.number(), attachmentCount: z.number(),
      reversalOf: z.object({ id: z.string(), voucherNumber: z.string() }).nullable(),
      reversals: z.array(z.object({ id: z.string(), voucherNumber: z.string() })),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});
type DraftInput = z.input<typeof voucherDraftSchema>;

const voucherTypes = [
  ["OPENING_BALANCE", "Opening balance", "प्रारंभिक शेष"],
  ["JOURNAL", "Journal", "जर्नल"],
  ["SALES", "Sales", "बिक्री"],
  ["PURCHASE", "Purchase", "खरीद"],
  ["PAYMENT", "Payment", "भुगतान"],
  ["RECEIPT", "Receipt", "रसीद"],
  ["CONTRA", "Contra", "कॉन्ट्रा"],
] as const;
const voucherStatuses = [
  ["DRAFT", "Draft", "मसौदा"],
  ["POSTED", "Posted", "पोस्ट किया"],
  ["CANCELLED", "Cancelled", "रद्द"],
  ["REVERSED", "Reversed", "रिवर्स"],
] as const;
function voucherTypeLabel(value: string, copy: (english: string, hindi: string) => string) {
  const match = voucherTypes.find(([key]) => key === value);
  return match ? copy(match[1], match[2]) : value;
}
function voucherStatusLabel(value: string, copy: (english: string, hindi: string) => string) {
  const match = voucherStatuses.find(([key]) => key === value);
  return match ? copy(match[1], match[2]) : value;
}

export function VouchersManager({
  locale,
  canCreate,
}: {
  locale: Locale;
  canCreate: boolean;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [showDraftForm, setShowDraftForm] = useState(false);

  const options = useQuery({
    queryKey: ["voucher-options"],
    enabled: canCreate,
    queryFn: async () => {
      const response = await fetch("/api/accounting/vouchers/options");
      if (!response.ok) throw new Error(copy("Could not load voucher options.", "वाउचर विकल्प लोड नहीं हो सके।"));
      return optionsSchema.parse(await response.json()).data;
    },
  });
  const vouchers = useQuery({
    queryKey: ["vouchers", search, status, type, from, to, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/accounting/vouchers?${params}`);
      if (!response.ok) throw new Error(copy("Could not load vouchers.", "वाउचर लोड नहीं हो सके।"));
      return listSchema.parse(await response.json()).data;
    },
  });

  const form = useForm<DraftInput, unknown, z.output<typeof voucherDraftSchema>>({
    resolver: zodResolver(voucherDraftSchema),
    defaultValues: {
      type: "JOURNAL",
      voucherDate: new Date().toISOString().slice(0, 10),
      narration: "",
      lines: [
        { ledgerId: "", description: "", debit: "0.00", credit: "0.00", bills: [], taxes: [], costAllocations: [] },
        { ledgerId: "", description: "", debit: "0.00", credit: "0.00", bills: [], taxes: [], costAllocations: [] },
      ],
      attachments: [],
    },
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const watchedLines = useWatch({ control: form.control, name: "lines" });
  const createDraft = useMutation({
    mutationFn: async (payload: z.output<typeof voucherDraftSchema>) => {
      const response = await fetch("/api/accounting/vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { data?: { voucher?: { id: string } }; error?: { message?: string } };
      if (!response.ok || !body.data?.voucher) throw new Error(body.error?.message ?? copy("Could not create draft.", "मसौदा नहीं बनाया जा सका।"));
      return body.data.voucher;
    },
    onSuccess: async (voucher) => {
      await client.invalidateQueries({ queryKey: ["vouchers"] });
      router.push(`/dashboard/vouchers/${voucher.id}`);
    },
  });
  const total = vouchers.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy("Vouchers", "वाउचर")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">{copy("Create drafts, review approval history, post balanced transactions and reverse posted documents with an auditable trail.", "मसौदे बनाएँ, अनुमोदन इतिहास देखें, संतुलित लेनदेन पोस्ट करें और ऑडिट ट्रेल सहित पोस्ट किए दस्तावेज़ रिवर्स करें।")}</p>
        </div>
        {canCreate && <Button onClick={() => setShowDraftForm((visible) => !visible)}>{showDraftForm ? copy("Close draft form", "मसौदा फ़ॉर्म बंद करें") : copy("New voucher draft", "नया वाउचर मसौदा")}</Button>}
      </header>

      {showDraftForm && canCreate && <form
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-5"
        onSubmit={form.handleSubmit((values) => createDraft.mutate(values))}
      >
        <h2 className="text-lg font-semibold">{copy("Draft details", "मसौदे का विवरण")}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">{copy("Voucher type", "वाउचर प्रकार")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" {...form.register("type")}>
              {voucherTypes.map(([value, en, hi]) => <option key={value} value={value}>{copy(en, hi)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">{copy("Date", "तिथि")}<Input type="date" {...form.register("voucherDate")} /></label>
          <label className="grid gap-1 text-sm">{copy("Narration", "विवरण")}<Input maxLength={500} {...form.register("narration")} /></label>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="font-medium">{copy("Voucher lines", "वाउचर पंक्तियाँ")}</h3>
            <Button type="button" variant="secondary" size="sm" onClick={() => lines.append({ ledgerId: "", description: "", debit: "0.00", credit: "0.00", bills: [], taxes: [], costAllocations: [] })}>{copy("Add line", "पंक्ति जोड़ें")}</Button>
          </div>
          {lines.fields.map((field, index) => <fieldset key={field.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(180px,1.2fr)_minmax(130px,1fr)_130px_130px_auto]">
            <legend className="px-1 text-xs text-slate-500">{copy("Line", "पंक्ति")} {index + 1}</legend>
            <label className="grid gap-1 text-xs">{copy("Ledger", "खाता")}
              <select className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm" {...form.register(`lines.${index}.ledgerId`)}>
                <option value="">{copy("Select ledger", "खाता चुनें")}</option>
                {(options.data?.ledgers ?? []).map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.name}{ledger.code ? ` (${ledger.code})` : ""}</option>)}
              </select>
              {form.formState.errors.lines?.[index]?.ledgerId && <span className="text-red-700">{copy("Select a ledger.", "खाता चुनें।")}</span>}
            </label>
            <label className="grid gap-1 text-xs">{copy("Description", "विवरण")}<Input maxLength={240} {...form.register(`lines.${index}.description`)} /></label>
            <label className="grid gap-1 text-xs">{copy("Debit", "नामे")}<Input inputMode="decimal" {...form.register(`lines.${index}.debit`)} /></label>
            <label className="grid gap-1 text-xs">{copy("Credit", "जमा")}<Input inputMode="decimal" {...form.register(`lines.${index}.credit`)} /></label>
            <Button type="button" variant="ghost" disabled={lines.fields.length <= 2} onClick={() => lines.remove(index)} aria-label={copy(`Remove line ${index + 1}`, `पंक्ति ${index + 1} हटाएँ`)}>×</Button>
            <details className="sm:col-span-full">
              <summary className="cursor-pointer text-sm font-medium text-blue-700">{copy("Tax, bills, cost and stock details", "कर, बिल, लागत और स्टॉक विवरण")}</summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold">{copy("Bill-wise allocation", "बिल-वार आवंटन")}</h4>
                  {(watchedLines?.[index]?.bills ?? []).map((_, billIndex) => <div key={billIndex} className="grid gap-2 sm:grid-cols-4">
                    <select className="h-10 rounded-md border bg-white px-2 text-sm" {...form.register(`lines.${index}.bills.${billIndex}.referenceType`)}><option value="NEW">NEW</option><option value="AGAINST_REF">AGAINST_REF</option><option value="ON_ACCOUNT">ON_ACCOUNT</option></select>
                    <Input placeholder={copy("Reference", "संदर्भ")} {...form.register(`lines.${index}.bills.${billIndex}.referenceNumber`)} />
                    <Input type="date" aria-label={copy("Bill due date", "बिल देय तिथि")} {...form.register(`lines.${index}.bills.${billIndex}.dueDate`)} />
                    <div className="flex gap-1"><Input inputMode="decimal" placeholder={copy("Amount", "राशि")} {...form.register(`lines.${index}.bills.${billIndex}.amount`)} /><Button type="button" variant="ghost" onClick={() => form.setValue(`lines.${index}.bills`, (form.getValues(`lines.${index}.bills`) ?? []).filter((_, itemIndex) => itemIndex !== billIndex))}>×</Button></div>
                  </div>)}
                  <Button type="button" variant="secondary" size="sm" onClick={() => form.setValue(`lines.${index}.bills`, [...(form.getValues(`lines.${index}.bills`) ?? []), { referenceType: "NEW", referenceNumber: "", dueDate: "", amount: "0.00" }])}>{copy("Add bill allocation", "बिल आवंटन जोड़ें")}</Button>
                </div>
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold">{copy("Cost allocation", "लागत आवंटन")}</h4>
                  {(watchedLines?.[index]?.costAllocations ?? []).map((_, allocationIndex) => <div key={allocationIndex} className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
                    <select className="h-10 rounded-md border bg-white px-2 text-sm" {...form.register(`lines.${index}.costAllocations.${allocationIndex}.costCentreId`)}><option value="">{copy("Select cost centre", "लागत केंद्र चुनें")}</option>{options.data?.costCentres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}</select>
                    <Input inputMode="decimal" aria-label={copy("Allocation amount", "आवंटन राशि")} {...form.register(`lines.${index}.costAllocations.${allocationIndex}.amount`)} />
                    <Button type="button" variant="ghost" onClick={() => form.setValue(`lines.${index}.costAllocations`, (form.getValues(`lines.${index}.costAllocations`) ?? []).filter((_, itemIndex) => itemIndex !== allocationIndex))}>×</Button>
                  </div>)}
                  <Button type="button" variant="secondary" size="sm" onClick={() => form.setValue(`lines.${index}.costAllocations`, [...(form.getValues(`lines.${index}.costAllocations`) ?? []), { costCentreId: "", amount: "0.00" }])}>{copy("Add cost allocation", "लागत आवंटन जोड़ें")}</Button>
                </div>
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold">{copy("Tax detail", "कर विवरण")}</h4>
                  {(watchedLines?.[index]?.taxes ?? []).map((_, taxIndex) => <div key={taxIndex} className="grid gap-2 sm:grid-cols-2">
                    <select className="h-10 rounded-md border bg-white px-2 text-sm" {...form.register(`lines.${index}.taxes.${taxIndex}.taxLedgerId`)}><option value="">{copy("Tax ledger", "कर खाता")}</option>{options.data?.ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.name}</option>)}</select>
                    <select className="h-10 rounded-md border bg-white px-2 text-sm" {...form.register(`lines.${index}.taxes.${taxIndex}.taxType`)}>{["CGST", "SGST", "IGST", "CESS", "TDS", "TCS", "OTHER"].map((value) => <option key={value}>{value}</option>)}</select>
                    <Input inputMode="decimal" aria-label={copy("Taxable amount", "कर योग्य राशि")} {...form.register(`lines.${index}.taxes.${taxIndex}.taxableAmount`)} />
                    <Input inputMode="decimal" aria-label={copy("Tax amount", "कर राशि")} {...form.register(`lines.${index}.taxes.${taxIndex}.taxAmount`)} />
                    <Input inputMode="decimal" aria-label={copy("Tax rate", "कर दर")} {...form.register(`lines.${index}.taxes.${taxIndex}.rate`)} />
                    <Button type="button" variant="ghost" onClick={() => form.setValue(`lines.${index}.taxes`, (form.getValues(`lines.${index}.taxes`) ?? []).filter((_, itemIndex) => itemIndex !== taxIndex))}>{copy("Remove tax", "कर हटाएँ")}</Button>
                  </div>)}
                  <Button type="button" variant="secondary" size="sm" onClick={() => form.setValue(`lines.${index}.taxes`, [...(form.getValues(`lines.${index}.taxes`) ?? []), { taxLedgerId: "", taxType: "CGST", taxableAmount: "0.00", taxAmount: "0.00", rate: "0" }])}>{copy("Add tax", "कर जोड़ें")}</Button>
                </div>
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <h4 className="text-sm font-semibold">{copy("Inventory movement", "इन्वेंटरी गतिविधि")}</h4>
                  {!watchedLines?.[index]?.stock && <Button type="button" variant="secondary" size="sm" onClick={() => form.setValue(`lines.${index}.stock`, { itemId: "", warehouseId: "", batchNumber: "", manufacturingDate: "", expiryDate: "", movementType: "ADJUSTMENT", direction: "IN", quantity: "1", unitCost: "0" })}>{copy("Add stock detail", "स्टॉक विवरण जोड़ें")}</Button>}
                  {watchedLines?.[index]?.stock && <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select className="h-10 rounded-md border bg-white px-2 text-sm" {...form.register(`lines.${index}.stock.itemId`)}><option value="">{copy("Select item", "आइटम चुनें")}</option>{options.data?.stockItems.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.baseUnit.symbol}</option>)}</select>
                      <select className="h-10 rounded-md border bg-white px-2 text-sm" {...form.register(`lines.${index}.stock.warehouseId`)}><option value="">{copy("Select warehouse", "गोदाम चुनें")}</option>{options.data?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select>
                      <select className="h-10 rounded-md border bg-white px-2 text-sm" {...form.register(`lines.${index}.stock.direction`)}><option value="IN">IN</option><option value="OUT">OUT</option></select>
                      <select className="h-10 rounded-md border bg-white px-2 text-sm" {...form.register(`lines.${index}.stock.movementType`)}>{["PURCHASE", "SALES", "SALES_RETURN", "PURCHASE_RETURN", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT", "PRODUCTION_IN", "PRODUCTION_OUT", "JOB_WORK_IN", "JOB_WORK_OUT"].map((value) => <option key={value}>{value}</option>)}</select>
                      <Input inputMode="decimal" aria-label={copy("Quantity", "मात्रा")} {...form.register(`lines.${index}.stock.quantity`)} />
                      <Input inputMode="decimal" aria-label={copy("Unit cost", "इकाई लागत")} {...form.register(`lines.${index}.stock.unitCost`)} />
                      <Input placeholder={copy("Batch number", "बैच नंबर")} {...form.register(`lines.${index}.stock.batchNumber`)} />
                      <Input type="date" aria-label={copy("Manufacturing date", "निर्माण तिथि")} {...form.register(`lines.${index}.stock.manufacturingDate`)} />
                      <Input type="date" aria-label={copy("Expiry date", "समाप्ति तिथि")} {...form.register(`lines.${index}.stock.expiryDate`)} />
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => form.setValue(`lines.${index}.stock`, undefined)}>{copy("Remove stock detail", "स्टॉक विवरण हटाएँ")}</Button>
                  </>}
                </div>
              </div>
            </details>
          </fieldset>)}
          {form.formState.errors.lines?.root?.message && <p role="alert" className="text-sm text-red-700">{form.formState.errors.lines.root.message}</p>}
        </div>
        {createDraft.isError && <p role="alert" className="text-sm text-red-700">{createDraft.error.message}</p>}
        {options.isError && <p role="alert" className="text-sm text-red-700">{options.error.message}</p>}
        <Button type="submit" disabled={createDraft.isPending || options.isPending || !options.data?.ledgers.length}>
          {createDraft.isPending ? copy("Creating draft…", "मसौदा बनाया जा रहा है…") : copy("Save draft", "मसौदा सहेजें")}
        </Button>
        {options.data && options.data.ledgers.length === 0 && <p className="text-sm text-amber-800">{copy("Create at least one active ledger before drafting a voucher.", "वाउचर मसौदा बनाने से पहले कम से कम एक सक्रिय खाता बनाएँ।")}</p>}
      </form>}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="grid gap-1 text-sm">{copy("Search", "खोजें")}<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={copy("Number or narration", "नंबर या विवरण")} /></label>
          <label className="grid gap-1 text-sm">{copy("Type", "प्रकार")}<select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="">{copy("All types", "सभी प्रकार")}</option>{voucherTypes.map(([value, en, hi]) => <option key={value} value={value}>{copy(en, hi)}</option>)}</select></label>
          <label className="grid gap-1 text-sm">{copy("Status", "स्थिति")}<select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">{copy("All statuses", "सभी स्थितियाँ")}</option>{voucherStatuses.map(([value, en, hi]) => <option key={value} value={value}>{copy(en, hi)}</option>)}</select></label>
          <label className="grid gap-1 text-sm">{copy("From", "से")}<Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
          <label className="grid gap-1 text-sm">{copy("To", "तक")}<Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
        </div>
        {vouchers.isPending && <p role="status" className="py-8 text-sm">{copy("Loading vouchers…", "वाउचर लोड हो रहे हैं…")}</p>}
        {vouchers.isError && <p role="alert" className="py-8 text-sm text-red-700">{vouchers.error.message}</p>}
        {vouchers.data?.vouchers.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No vouchers match these filters.", "इन फ़िल्टर से कोई वाउचर नहीं मिला।")}</p>}
        {!!vouchers.data?.vouchers.length && <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Voucher", "वाउचर")}</th><th>{copy("Date", "तिथि")}</th><th>{copy("Type / status", "प्रकार / स्थिति")}</th><th>{copy("Narration", "विवरण")}</th><th className="text-right">{copy("Debit", "नामे")}</th><th className="text-right">{copy("Credit", "जमा")}</th><th className="text-right">{copy("Lines", "पंक्तियाँ")}</th></tr></thead>
            <tbody className="divide-y">{vouchers.data.vouchers.map((voucher) => <tr key={voucher.id}>
              <td className="py-3 font-medium"><Link href={`/dashboard/vouchers/${voucher.id}`} className="text-blue-700 hover:underline">{voucher.voucherNumber}</Link></td>
              <td>{voucher.voucherDate}</td>              <td>{voucherTypeLabel(voucher.type, copy)}<span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs">{voucherStatusLabel(voucher.status, copy)}</span>{voucher.approvalStatus === "PENDING" && <span className="ml-2 text-amber-800">{copy("Approval pending", "अनुमोदन लंबित")}</span>}</td>
              <td className="max-w-xs truncate">{voucher.narration || "—"}</td><td className="text-right tabular-nums">{voucher.debitTotal}</td><td className="text-right tabular-nums">{voucher.creditTotal}</td><td className="text-right">{voucher.lineCount}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <span>{copy("Records", "रिकॉर्ड")}: {total}</span>
          <div className="flex items-center gap-2"><Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{copy("Previous", "पिछला")}</Button><span>{page} / {pageCount}</span><Button type="button" variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>{copy("Next", "अगला")}</Button></div>
        </div>
      </section>
    </div>
  );
}
