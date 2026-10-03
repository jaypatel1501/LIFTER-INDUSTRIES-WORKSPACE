"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Locale } from "@prisma/client";
import { useEffect, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { voucherDraftSchema } from "@/lib/validation/vouchers";

const voucherTypes = ["OPENING_BALANCE", "JOURNAL", "SALES", "PURCHASE", "PAYMENT", "RECEIPT", "CONTRA", "SALES_RETURN", "CREDIT_NOTE", "DEBIT_NOTE"] as const;
type DraftInput = z.input<typeof voucherDraftSchema>;
type DraftBill = NonNullable<DraftInput["lines"][number]["bills"]>[number];
type DraftTax = NonNullable<DraftInput["lines"][number]["taxes"]>[number];
type DraftStock = NonNullable<DraftInput["lines"][number]["stock"]>;
const voucherTypeLabels: Record<(typeof voucherTypes)[number], [string, string]> = {
  OPENING_BALANCE: ["Opening balance", "प्रारंभिक शेष"],
  JOURNAL: ["Journal", "जर्नल"],
  SALES: ["Sales", "बिक्री"],
  PURCHASE: ["Purchase", "खरीद"],
  PAYMENT: ["Payment", "भुगतान"],
  RECEIPT: ["Receipt", "रसीद"],
  CONTRA: ["Contra", "कॉन्ट्रा"],
  SALES_RETURN: ["Sales return", "बिक्री वापसी"],
  CREDIT_NOTE: ["Credit note", "क्रेडिट नोट"],
  DEBIT_NOTE: ["Debit note", "डेबिट नोट"],
};
const voucherStatusLabels: Record<string, [string, string]> = {
  DRAFT: ["Draft", "मसौदा"],
  POSTED: ["Posted", "पोस्ट किया"],
  CANCELLED: ["Cancelled", "रद्द"],
  REVERSED: ["Reversed", "रिवर्स"],
};
function cents(value: string | number) {
  const [whole = "0", fraction = ""] = String(value).split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function formatCents(value: bigint) {
  const units = value / BigInt(100);
  const fraction = String(value % BigInt(100)).padStart(2, "0");
  return `${units}.${fraction}`;
}
const optionsSchema = z.object({
  success: z.literal(true),
  data: z.object({ ledgers: z.array(z.object({ id: z.string(), name: z.string(), code: z.string().nullable() })) }),
});
const detailSchema = z.object({
  success: z.literal(true),
  data: z.object({
    voucher: z.object({
      id: z.string(), voucherNumber: z.string(), type: z.enum(voucherTypes), status: z.string(),
      approvalStatus: z.string(), voucherDate: z.string(), narration: z.string().nullable(),
      paymentMethod: z.string().nullable(), paymentReference: z.string().nullable(), paymentDate: z.string().nullable(), paymentBank: z.string().nullable(),
      createdAt: z.string(), createdById: z.string().nullable(), postedAt: z.string().nullable(),
      numberSeries: z.object({ id: z.string(), prefix: z.string(), suffix: z.string(), requiresApproval: z.boolean() }).nullable(),
      financialYear: z.object({ id: z.string(), name: z.string() }).nullable(),
      lines: z.array(z.object({
        id: z.string(), lineNumber: z.number(), description: z.string().nullable(),
        debit: z.union([z.string(), z.number()]), credit: z.union([z.string(), z.number()]),
        ledger: z.object({ id: z.string(), name: z.string(), code: z.string().nullable(), type: z.string() }),
        billEntries: z.array(z.object({
          id: z.string(), referenceType: z.string(), referenceNumber: z.string().nullable(),
          settlesEntryId: z.string().nullable(), settlesOpeningId: z.string().nullable(),
          dueDate: z.string().nullable(), amount: z.union([z.string(), z.number()]),
        })),
        taxDetails: z.array(z.object({
          id: z.string(), taxType: z.string(), taxableAmount: z.union([z.string(), z.number()]),
          taxAmount: z.union([z.string(), z.number()]), rate: z.union([z.string(), z.number()]),
          taxLedger: z.object({ id: z.string(), name: z.string(), code: z.string().nullable() }),
        })),
        costAllocations: z.array(z.object({
          id: z.string(), amount: z.union([z.string(), z.number()]),
          costCentre: z.object({ id: z.string(), name: z.string(), code: z.string() }),
        })),
        inventoryDetails: z.array(z.object({
          id: z.string(), batchNumber: z.string().nullable(), movementType: z.string(), direction: z.string(),
          quantity: z.union([z.string(), z.number()]), unitCost: z.union([z.string(), z.number()]),
          manufacturingDate: z.string().nullable(), expiryDate: z.string().nullable(),
          item: z.object({ id: z.string(), name: z.string(), code: z.string() }),
          warehouse: z.object({ id: z.string(), name: z.string(), code: z.string() }),
        })),
      })),
      attachments: z.array(z.object({ id: z.string(), fileName: z.string(), contentType: z.string(), byteSize: z.number() })),
      approvals: z.array(z.object({ id: z.string(), decision: z.string(), reason: z.string().nullable(), createdAt: z.string(), actorId: z.string() })),
      auditEvents: z.array(z.object({ id: z.string(), action: z.string(), snapshot: z.unknown(), createdAt: z.string(), actorId: z.string().nullable() })),
      reversalOf: z.object({ id: z.string(), voucherNumber: z.string() }).nullable(),
      reversals: z.array(z.object({ id: z.string(), voucherNumber: z.string() })),
    }),
  }),
});

type Capabilities = {
  canUpdate: boolean;
  canPost: boolean;
  canCancel: boolean;
  canReverse: boolean;
  canApprove: boolean;
};

export function VoucherDetail({
  locale,
  voucherId,
  capabilities,
}: {
  locale: Locale;
  voucherId: string;
  capabilities: Capabilities;
}) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [attachment, setAttachment] = useState<File | null>(null);
  const [editMode, setEditMode] = useState(false);
  const draftForm = useForm<DraftInput, unknown, z.output<typeof voucherDraftSchema>>({
    resolver: zodResolver(voucherDraftSchema),
    defaultValues: {
      type: "JOURNAL", voucherDate: new Date().toISOString().slice(0, 10), narration: "", paymentMethod: undefined,
      paymentReference: "", paymentDate: "", paymentBank: "",
      lines: [
        { ledgerId: "", description: "", debit: "0.00", credit: "0.00", bills: [], taxes: [], costAllocations: [] },
        { ledgerId: "", description: "", debit: "0.00", credit: "0.00", bills: [], taxes: [], costAllocations: [] },
      ],
      attachments: [],
    },
  });
  const draftLines = useFieldArray({ control: draftForm.control, name: "lines" });
  const draftType = useWatch({ control: draftForm.control, name: "type" });
  const draftPaymentMethod = useWatch({ control: draftForm.control, name: "paymentMethod" });
  const { reset } = draftForm;
  const voucherQuery = useQuery({
    queryKey: ["voucher", voucherId],
    queryFn: async () => {
      const response = await fetch(`/api/accounting/vouchers/${voucherId}`);
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? copy("Could not load this voucher.", "वाउचर लोड नहीं हो सका।"));
      return detailSchema.parse(body).data.voucher;
    },
  });
  const options = useQuery({
    queryKey: ["voucher-options"],
    enabled: capabilities.canUpdate,
    queryFn: async () => {
      const response = await fetch("/api/accounting/vouchers/options");
      if (!response.ok) throw new Error(copy("Could not load ledger options.", "खाता विकल्प लोड नहीं हो सके।"));
      return optionsSchema.parse(await response.json()).data;
    },
  });
  useEffect(() => {
    const voucher = voucherQuery.data;
    if (!voucher) return;
    reset({
      type: voucher.type,
      voucherDate: voucher.voucherDate,
      narration: voucher.narration ?? "",
      paymentMethod: voucher.paymentMethod as DraftInput["paymentMethod"],
      paymentReference: voucher.paymentReference ?? "",
      paymentDate: voucher.paymentDate?.slice(0, 10) ?? "",
      paymentBank: voucher.paymentBank ?? "",
      attachments: [],
      lines: voucher.lines.map((line) => ({
        ledgerId: line.ledger.id,
        description: line.description ?? "",
        debit: String(line.debit),
        credit: String(line.credit),
        bills: line.billEntries.map((bill) => ({
          referenceType: bill.referenceType as DraftBill["referenceType"],
          referenceNumber: bill.referenceNumber ?? "",
          ...(bill.settlesEntryId ? { billEntryId: bill.settlesEntryId } : {}),
          ...(bill.settlesOpeningId ? { openingBillId: bill.settlesOpeningId } : {}),
          dueDate: bill.dueDate ? bill.dueDate.slice(0, 10) : "",
          amount: String(bill.amount),
        })),
        taxes: line.taxDetails.map((tax) => ({
          taxLedgerId: tax.taxLedger.id,
          taxType: tax.taxType as DraftTax["taxType"],
          taxableAmount: String(tax.taxableAmount),
          taxAmount: String(tax.taxAmount),
          rate: String(tax.rate),
        })),
        costAllocations: line.costAllocations.map((allocation) => ({
          costCentreId: allocation.costCentre.id,
          amount: String(allocation.amount),
        })),
        ...(line.inventoryDetails[0] ? {
          stock: {
            itemId: line.inventoryDetails[0].item.id,
            warehouseId: line.inventoryDetails[0].warehouse.id,
            batchNumber: line.inventoryDetails[0].batchNumber ?? "",
            manufacturingDate: line.inventoryDetails[0].manufacturingDate?.slice(0, 10) ?? "",
            expiryDate: line.inventoryDetails[0].expiryDate?.slice(0, 10) ?? "",
            movementType: line.inventoryDetails[0].movementType as DraftStock["movementType"],
            direction: line.inventoryDetails[0].direction as DraftStock["direction"],
            quantity: String(line.inventoryDetails[0].quantity),
            unitCost: String(line.inventoryDetails[0].unitCost),
          },
        } : {}),
      })),
    });
  }, [voucherQuery.data, reset]);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["voucher", voucherId] }),
      client.invalidateQueries({ queryKey: ["vouchers"] }),
    ]);
  };
  const action = useMutation({
    mutationFn: async (input: { path: string; method?: string; body?: unknown; idempotent?: boolean }) => {
      const response = await fetch(input.path
        ? `/api/accounting/vouchers/${voucherId}/${input.path}`
        : `/api/accounting/vouchers/${voucherId}`, {
        method: input.method ?? (input.path ? "POST" : "PATCH"),
        headers: {
          ...(input.body ? { "Content-Type": "application/json" } : {}),
          ...(input.idempotent ? { "Idempotency-Key": crypto.randomUUID() } : {}),
        },
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? copy("The voucher action failed.", "वाउचर कार्रवाई विफल हुई।"));
      return body;
    },
    onSuccess: refresh,
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!attachment) throw new Error(copy("Choose a file first.", "पहले फ़ाइल चुनें।"));
      const data = new FormData();
      data.set("file", attachment);
      const response = await fetch(`/api/accounting/vouchers/${voucherId}/attachments`, { method: "POST", body: data });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? copy("Could not upload the attachment.", "अटैचमेंट अपलोड नहीं हो सका।"));
      return body;
    },
    onSuccess: async () => { setAttachment(null); await refresh(); },
  });

  if (voucherQuery.isPending) return <p role="status" className="py-12">{copy("Loading voucher…", "वाउचर लोड हो रहा है…")}</p>;
  if (voucherQuery.isError) return <p role="alert" className="py-12 text-red-700">{voucherQuery.error.message}</p>;
  const voucher = voucherQuery.data;
  const totals = voucher.lines.reduce((total, line) => ({
    debit: total.debit + cents(line.debit),
    credit: total.credit + cents(line.credit),
  }), { debit: BigInt(0), credit: BigInt(0) });
  const displayType = voucherTypeLabels[voucher.type];
  const displayStatus = voucherStatusLabels[voucher.status] ?? [voucher.status, voucher.status];
  const isDraft = voucher.status === "DRAFT";
  const isPosted = voucher.status === "POSTED";
  const approvalRequired = voucher.numberSeries?.requiresApproval ?? false;
  const requestApproval = isDraft && approvalRequired &&
    (voucher.approvalStatus === "NOT_REQUIRED" || voucher.approvalStatus === "REJECTED");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/vouchers" className="print:hidden text-sm text-blue-700 hover:underline">← {copy("All vouchers", "सभी वाउचर")}</Link>
          <h1 className="mt-2 text-2xl font-semibold">{voucher.voucherNumber}</h1>
          <p className="mt-1 text-sm text-slate-600">{copy(displayType[0], displayType[1])} · {voucher.voucherDate} · {copy(displayStatus[0], displayStatus[1])}{voucher.financialYear ? ` · ${voucher.financialYear.name}` : ""}</p>
          {voucher.paymentMethod && <p className="mt-1 text-sm text-slate-600">{voucher.paymentMethod}{voucher.paymentReference ? ` · ${voucher.paymentReference}` : ""}{voucher.paymentDate ? ` · ${voucher.paymentDate.slice(0, 10)}` : ""}{voucher.paymentBank ? ` · ${voucher.paymentBank}` : ""}</p>}
        </div>
        <div className="print:hidden flex gap-2">
          <Button type="button" variant="secondary" onClick={() => window.print()}><Printer aria-hidden="true" size={16} />{copy("Print", "प्रिंट")}</Button>
          {isDraft && capabilities.canPost && (!approvalRequired || voucher.approvalStatus === "APPROVED") && <Button disabled={action.isPending} onClick={() => action.mutate({ path: "post", idempotent: true })}>{copy("Post voucher", "वाउचर पोस्ट करें")}</Button>}
        </div>
        {isDraft && capabilities.canCancel && <Button variant="destructive" disabled={action.isPending} onClick={() => action.mutate({ path: "cancel", idempotent: true })}>{copy("Cancel draft", "मसौदा रद्द करें")}</Button>}
      </header>

      {action.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{action.error.message}</p>}
      {isDraft && capabilities.canUpdate && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{copy("Draft editing", "मसौदा संपादन")}</h2><Button type="button" variant="secondary" onClick={() => setEditMode((open) => !open)}>{editMode ? copy("Close editor", "संपादक बंद करें") : copy("Edit draft", "मसौदा संपादित करें")}</Button></div>
        {editMode && <form className="mt-4 space-y-4" onSubmit={draftForm.handleSubmit((body) => action.mutate({ path: "", method: "PATCH", body }))}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm">{copy("Voucher type", "वाउचर प्रकार")}<select className="h-11 rounded-lg border border-slate-300 bg-white px-3" {...draftForm.register("type")}>{voucherTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label className="grid gap-1 text-sm">{copy("Date", "तिथि")}<Input type="date" {...draftForm.register("voucherDate")} /></label>
            <label className="grid gap-1 text-sm">{copy("Narration", "विवरण")}<Input maxLength={500} {...draftForm.register("narration")} /></label>
          </div>
          {["PAYMENT", "RECEIPT", "CONTRA"].includes(draftType) && <div className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-4">
            <label className="grid gap-1 text-sm">{copy("Payment method", "भुगतान का माध्यम")}
              <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={draftPaymentMethod ?? ""} onChange={(event) => draftForm.setValue("paymentMethod", event.target.value ? event.target.value as NonNullable<DraftInput["paymentMethod"]> : undefined, { shouldDirty: true, shouldValidate: true })}>
                <option value="">{copy("Choose method", "माध्यम चुनें")}</option>{["CASH", "BANK", "CHEQUE", "UPI", "NEFT", "RTGS"].map((method) => <option key={method} value={method}>{method}</option>)}
              </select>
            </label>
            {draftPaymentMethod && !["CASH", "BANK"].includes(draftPaymentMethod) && <label className="grid gap-1 text-sm">{copy("Transaction / cheque reference", "लेनदेन / चेक संदर्भ")}<Input required maxLength={120} {...draftForm.register("paymentReference")} /></label>}
            <label className="grid gap-1 text-sm">{copy("Instrument date", "भुगतान साधन तारीख")}<Input type="date" required={Boolean(draftPaymentMethod && !["CASH", "BANK"].includes(draftPaymentMethod))} {...draftForm.register("paymentDate")} /></label>
            {draftPaymentMethod !== "CASH" && <label className="grid gap-1 text-sm">{copy("Bank", "बैंक")}<Input maxLength={120} {...draftForm.register("paymentBank")} /></label>}
          </div>}
          {draftLines.fields.map((field, index) => <div key={field.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(180px,1.2fr)_1fr_130px_130px_auto]">
            <label className="grid gap-1 text-xs">{copy("Ledger", "खाता")}<select className="h-10 rounded-md border bg-white px-2 text-sm" {...draftForm.register(`lines.${index}.ledgerId`)}><option value="">{copy("Select ledger", "खाता चुनें")}</option>{options.data?.ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.name}{ledger.code ? ` (${ledger.code})` : ""}</option>)}</select></label>
            <label className="grid gap-1 text-xs">{copy("Description", "विवरण")}<Input maxLength={240} {...draftForm.register(`lines.${index}.description`)} /></label>
            <label className="grid gap-1 text-xs">{copy("Debit", "नामे")}<Input inputMode="decimal" {...draftForm.register(`lines.${index}.debit`)} /></label>
            <label className="grid gap-1 text-xs">{copy("Credit", "जमा")}<Input inputMode="decimal" {...draftForm.register(`lines.${index}.credit`)} /></label>
            <Button type="button" variant="ghost" disabled={draftLines.fields.length <= 2} onClick={() => draftLines.remove(index)} aria-label={copy("Remove line", "पंक्ति हटाएँ")}>×</Button>
          </div>)}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => draftLines.append({ ledgerId: "", description: "", debit: "0.00", credit: "0.00", bills: [], taxes: [], costAllocations: [] })}>{copy("Add line", "पंक्ति जोड़ें")}</Button>
            <Button disabled={action.isPending || options.isPending}>{action.isPending ? copy("Saving…", "सहेज रहे हैं…") : copy("Save draft", "मसौदा सहेजें")}</Button>
            {options.isError && <p role="alert" className="text-sm text-red-700">{options.error.message}</p>}
            {draftForm.formState.errors.lines && <p role="alert" className="w-full text-sm text-red-700">{copy("Review voucher lines and their accounting details.", "वाउचर पंक्तियों और लेखा विवरण की जाँच करें।")}</p>}
          </div>
        </form>}
      </section>}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div><h2 className="font-semibold">{copy("Posting lines", "पोस्टिंग पंक्तियाँ")}</h2>{voucher.narration && <p className="mt-1 text-sm text-slate-600">{voucher.narration}</p>}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Line", "पंक्ति")}</th><th>{copy("Ledger", "खाता")}</th><th>{copy("Description", "विवरण")}</th><th className="text-right">{copy("Debit", "नामे")}</th><th className="text-right">{copy("Credit", "जमा")}</th></tr></thead>
            <tbody className="divide-y">{voucher.lines.map((line) => <tr key={line.id}><td className="py-3">{line.lineNumber}</td><td className="font-medium">{line.ledger.name}{line.ledger.code && <span className="ml-1 text-xs text-slate-500">{line.ledger.code}</span>}</td><td>{line.description || "—"}</td><td className="text-right tabular-nums">{line.debit}</td><td className="text-right tabular-nums">{line.credit}</td></tr>)}</tbody>
            <tfoot className="border-t font-semibold"><tr><td className="py-3" colSpan={3}>{copy("Totals", "कुल")}</td><td className="text-right">{formatCents(totals.debit)}</td><td className="text-right">{formatCents(totals.credit)}</td></tr></tfoot>
          </table>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {voucher.lines.some((line) => line.billEntries.length) && <div className="rounded-lg bg-slate-50 p-4"><h3 className="font-medium">{copy("Bill-wise details", "बिल-वार विवरण")}</h3>{voucher.lines.flatMap((line) => line.billEntries.map((bill) => <p key={bill.id} className="mt-2 text-sm">{bill.referenceType}: {bill.referenceNumber || copy("On account", "खाते में")} · {bill.amount}{bill.dueDate ? ` · ${bill.dueDate.slice(0, 10)}` : ""}</p>))}</div>}
          {voucher.lines.some((line) => line.taxDetails.length) && <div className="rounded-lg bg-slate-50 p-4"><h3 className="font-medium">{copy("Tax details", "कर विवरण")}</h3>{voucher.lines.flatMap((line) => line.taxDetails.map((tax) => <p key={tax.id} className="mt-2 text-sm">{tax.taxType} · {tax.rate}% · {tax.taxAmount} · {tax.taxLedger.name}</p>))}</div>}
          {voucher.lines.some((line) => line.costAllocations.length) && <div className="rounded-lg bg-slate-50 p-4"><h3 className="font-medium">{copy("Cost allocations", "लागत आवंटन")}</h3>{voucher.lines.flatMap((line) => line.costAllocations.map((allocation) => <p key={allocation.id} className="mt-2 text-sm">{allocation.costCentre.name} ({allocation.costCentre.code}) · {allocation.amount}</p>))}</div>}
          {voucher.lines.some((line) => line.inventoryDetails.length) && <div className="rounded-lg bg-slate-50 p-4"><h3 className="font-medium">{copy("Inventory details", "इन्वेंटरी विवरण")}</h3>{voucher.lines.flatMap((line) => line.inventoryDetails.map((detail) => <p key={detail.id} className="mt-2 text-sm">{detail.item.name} · {detail.warehouse.name} · {detail.direction} {detail.quantity} · {detail.movementType}{detail.batchNumber ? ` · ${copy("Batch", "बैच")} ${detail.batchNumber}` : ""}</p>))}</div>}
        </div>
      </section>

      {requestApproval && capabilities.canUpdate && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">{copy("Approval required", "अनुमोदन आवश्यक")}</h2>
        <p className="mt-1 text-sm text-slate-600">{copy("This voucher cannot be posted until another authorized company member approves it.", "दूसरे अधिकृत कंपनी सदस्य की मंज़ूरी से पहले यह वाउचर पोस्ट नहीं किया जा सकता।")}</p>
        <Button className="mt-3" disabled={action.isPending} onClick={() => action.mutate({ path: "request-approval", idempotent: true })}>{copy("Request approval", "अनुमोदन माँगें")}</Button>
      </section>}
      {isDraft && voucher.approvalStatus === "PENDING" && capabilities.canApprove && <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="font-semibold">{copy("Approval decision", "अनुमोदन निर्णय")}</h2>
        <label className="grid max-w-xl gap-1 text-sm">{copy("Decision note", "निर्णय टिप्पणी")}<Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label>
        <div className="flex gap-2"><Button disabled={action.isPending} onClick={() => action.mutate({ path: "approve", body: { decision: "APPROVED", reason }, idempotent: true })}>{copy("Approve", "अनुमोदित करें")}</Button><Button variant="destructive" disabled={action.isPending} onClick={() => action.mutate({ path: "approve", body: { decision: "REJECTED", reason }, idempotent: true })}>{copy("Reject", "अस्वीकार करें")}</Button></div>
      </section>}
      {isPosted && capabilities.canReverse && voucher.reversals.length === 0 && <form className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5 sm:grid-cols-[220px_1fr_auto]" onSubmit={(event) => { event.preventDefault(); action.mutate({ path: "reverse", body: { reversalDate, reason }, idempotent: true }); }}>
        <label className="grid gap-1 text-sm">{copy("Reversal date", "रिवर्सल तिथि")}<Input type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} required /></label>
        <label className="grid gap-1 text-sm">{copy("Reason", "कारण")}<Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required /></label>
        <Button className="self-end" variant="destructive" disabled={action.isPending || !reason.trim()}>{copy("Reverse voucher", "वाउचर रिवर्स करें")}</Button>
      </form>}
      {voucher.reversalOf && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">{copy("Reversal of", "का रिवर्सल")}: <Link className="text-blue-700 hover:underline" href={`/dashboard/vouchers/${voucher.reversalOf.id}`}>{voucher.reversalOf.voucherNumber}</Link></p>}
      {!!voucher.reversals.length && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">{copy("Reversed by", "द्वारा रिवर्स")}: {voucher.reversals.map((reversal) => <Link key={reversal.id} className="ml-2 text-blue-700 hover:underline" href={`/dashboard/vouchers/${reversal.id}`}>{reversal.voucherNumber}</Link>)}</p>}

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">{copy("Attachments", "अटैचमेंट")}</h2>
          {voucher.attachments.length === 0 && <p className="text-sm text-slate-500">{copy("No attachments.", "कोई अटैचमेंट नहीं।")}</p>}
          <ul className="space-y-2">{voucher.attachments.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{item.fileName} · {(item.byteSize / 1024).toFixed(0)} KB</span><a className="text-blue-700 hover:underline" href={`/api/accounting/vouchers/${voucher.id}/attachments/${item.id}`}>{copy("Download", "डाउनलोड")}</a></li>)}</ul>
          {isDraft && capabilities.canUpdate && <div className="flex flex-wrap items-end gap-2 border-t pt-3"><label className="grid flex-1 gap-1 text-sm">{copy("Add PDF or image", "PDF या छवि जोड़ें")}<Input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /></label><Button type="button" variant="secondary" disabled={!attachment || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? copy("Uploading…", "अपलोड हो रहा है…") : copy("Upload", "अपलोड करें")}</Button></div>}
          {upload.isError && <p role="alert" className="text-sm text-red-700">{upload.error.message}</p>}
        </div>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">{copy("Approval & audit history", "अनुमोदन और ऑडिट इतिहास")}</h2>
          {voucher.approvals.length === 0 && voucher.auditEvents.length === 0 && <p className="text-sm text-slate-500">{copy("No history available.", "कोई इतिहास उपलब्ध नहीं।")}</p>}
          <ol className="space-y-2">{voucher.auditEvents.map((event) => <li key={event.id} className="border-l-2 border-blue-200 pl-3 text-sm"><strong>{copy(event.action.replaceAll("_", " "), event.action)}</strong><span className="ml-2 text-xs text-slate-500">{new Date(event.createdAt).toLocaleString(locale === "HI" ? "hi-IN" : "en-IN")}</span><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-500">{JSON.stringify(event.snapshot)}</pre></li>)}</ol>
          <ul className="space-y-2">{voucher.approvals.map((entry) => <li key={entry.id} className="text-sm"><strong>{copy(entry.decision, entry.decision)}</strong><span className="ml-2 text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString(locale === "HI" ? "hi-IN" : "en-IN")} · {entry.actorId}</span>{entry.reason && <p className="text-slate-600">{entry.reason}</p>}</li>)}</ul>
        </div>
      </section>
    </div>
  );
}
