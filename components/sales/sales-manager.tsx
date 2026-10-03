"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { salesDocumentCreateSchema } from "@/lib/validation/sales";
import { z } from "zod";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    documents: z.array(z.object({
      id: z.string(), documentNumber: z.string(),
      documentType: z.enum(["QUOTATION", "SALES_ORDER", "DELIVERY_NOTE", "SALES_INVOICE"]),
      status: z.string(), documentDate: z.string(), totalAmount: z.string(),
      party: z.object({ id: z.string(), name: z.string() }),
      sourceDocument: z.object({ id: z.string(), documentNumber: z.string(), documentType: z.string() }).nullable(),
      voucher: z.object({ id: z.string(), voucherNumber: z.string() }).nullable(),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});
const optionsSchema = z.object({
  success: z.literal(true),
  data: z.object({
    customers: z.array(z.object({
      id: z.string(), name: z.string(), stateCode: z.string().nullable(),
      addressLine1: z.string().nullable(), addressLine2: z.string().nullable(),
      city: z.string().nullable(), state: z.string().nullable(), postalCode: z.string().nullable(),
      country: z.string(),
    })),
    items: z.array(z.object({
      id: z.string(), name: z.string(), hsnSac: z.string().nullable(), gstRate: z.string(),
      salesRate: z.string(), batchTracked: z.boolean(), baseUnit: z.object({ symbol: z.string() }),
    })),
    warehouses: z.array(z.object({ id: z.string(), name: z.string() })),
    paymentLedgers: z.array(z.object({ id: z.string(), name: z.string(), type: z.enum(["CASH", "BANK"]) })),
  }),
});

type DraftLine = {
  itemId: string; description: string; unit: string; quantity: string; unitRate: string; gstRate: string;
  warehouseId: string; batchNumber: string;
};

export function SalesManager({ locale, companyName, canCreate, canIssue, canPost, canSend, canCancel }: {
  locale: Locale; companyName: string; canCreate: boolean; canIssue: boolean; canPost: boolean; canSend: boolean; canCancel: boolean;
}) {
  const queryClient = useQueryClient();
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const [search, setSearch] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [page, setPage] = useState(1);
  const [customerId, setCustomerId] = useState("");
  const [newType, setNewType] = useState<"QUOTATION" | "SALES_ORDER">("QUOTATION");
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [billingAddressLine1, setBillingAddressLine1] = useState("");
  const [shippingAddressLine1, setShippingAddressLine1] = useState("");
  const [freight, setFreight] = useState("0");
  const [otherCharges, setOtherCharges] = useState("0");
  const [roundOff, setRoundOff] = useState("0");
  const [invoicePaymentMode, setInvoicePaymentMode] = useState<"CREDIT" | "CASH">("CREDIT");
  const [paymentLedgerId, setPaymentLedgerId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", description: "", unit: "EA", quantity: "1", unitRate: "0", gstRate: "0", warehouseId: "", batchNumber: "" }]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const documentsQuery = useQuery({
    queryKey: ["sales-documents", search, documentType, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search) params.set("search", search);
      if (documentType) params.set("documentType", documentType);
      const response = await fetch(`/api/sales?${params}`);
      if (!response.ok) throw new Error("Could not load sales documents.");
      return responseSchema.parse(await response.json()).data;
    },
  });
  const optionsQuery = useQuery({
    queryKey: ["sales-options"],
    queryFn: async () => {
      const response = await fetch("/api/sales/options");
      if (!response.ok) throw new Error("Could not load customers, stock items and godowns.");
      return optionsSchema.parse(await response.json()).data;
    },
  });
  const customers = optionsQuery.data?.customers ?? [];
  const items = optionsQuery.data?.items ?? [];
  const warehouses = optionsQuery.data?.warehouses ?? [];
  const pages = Math.max(1, Math.ceil((documentsQuery.data?.total ?? 0) / 20));
  const lineTotal = useMemo(() => lines.reduce((sum, line) => {
    const base = Number(line.quantity) * Number(line.unitRate);
    return sum + base + base * Number(line.gstRate || 0) / 100;
  }, 0), [lines]);

  async function request(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as { success: boolean; error?: { message?: string } };
    if (!response.ok || !result.success) throw new Error(result.error?.message ?? "The sales action failed.");
    await queryClient.invalidateQueries({ queryKey: ["sales-documents"] });
    return result;
  }

  async function createDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const payload = {
      documentType: newType,
      partyId: customerId,
      documentDate,
      notes,
      freight,
      otherCharges,
      roundOff,
      billingAddress: { addressLine1: billingAddressLine1 },
      shippingAddress: { addressLine1: shippingAddressLine1 },
      lines: lines.map((line) => {
        const item = items.find((candidate) => candidate.id === line.itemId);
        return {
          ...(line.itemId ? { itemId: line.itemId } : {}),
          description: line.description || item?.name || "Service",
          unit: item?.baseUnit.symbol ?? line.unit,
          quantity: line.quantity,
          unitRate: line.unitRate,
          ...(line.itemId ? {
            ...(line.warehouseId ? { warehouseId: line.warehouseId } : {}),
            batchNumber: line.batchNumber,
          } : {}),
          ...(!line.itemId ? { gstRate: line.gstRate } : {}),
        };
      }),
    };
    const parsed = salesDocumentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Check the sales document details.");
      return;
    }
    setBusy("create");
    try {
      await request("/api/sales", parsed.data);
      setMessage(copy("Draft saved. Issue it when ready.", "मसौदा सहेजा गया। तैयार होने पर जारी करें।"));
      setNotes("");
      setFreight("0");
      setOtherCharges("0");
      setRoundOff("0");
      setLines([{ itemId: "", description: "", unit: "EA", quantity: "1", unitRate: "0", gstRate: "0", warehouseId: "", batchNumber: "" }]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the sales document.");
    } finally {
      setBusy("");
    }
  }

  async function doAction(id: string, suffix: string, body?: unknown, busyKey = id) {
    setBusy(busyKey);
    setMessage("");
    try {
      await request(`/api/sales/${id}/${suffix}`, body);
      setMessage(copy("Sales document updated.", "बिक्री दस्तावेज़ अपडेट हुआ।"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The sales action failed.");
    } finally {
      setBusy("");
    }
  }

  async function convert(id: string, type: "SALES_ORDER" | "DELIVERY_NOTE" | "SALES_INVOICE") {
    setBusy(id);
    setMessage("");
    try {
      const detailResponse = await fetch(`/api/sales/${id}`);
      const detail = await detailResponse.json() as { success: boolean; data?: { document?: { lines?: Array<{ id: string; quantity: string; deliveredQuantity: string; invoicedQuantity: string; itemId: string | null; warehouseId: string | null; batchNumber: string | null }> } }; error?: { message?: string } };
      if (!detailResponse.ok || !detail.success || !detail.data?.document) throw new Error(detail.error?.message ?? "Could not load source document.");
      const sourceLines = detail.data.document.lines ?? [];
      const linesToConvert = sourceLines.map((line) => ({
        sourceLineId: line.id,
        quantity: type === "DELIVERY_NOTE"
          ? (Number(line.quantity) - Number(line.deliveredQuantity)).toString()
          : type === "SALES_INVOICE"
            ? (Number(line.quantity) - Number(line.invoicedQuantity)).toString()
            : line.quantity,
        ...(type === "DELIVERY_NOTE" || type === "SALES_INVOICE"
          ? { warehouseId: line.warehouseId ?? warehouses[0]?.id, batchNumber: line.batchNumber ?? "" }
          : {}),
      })).filter((line) => Number(line.quantity) > 0);
      if (!linesToConvert.length) throw new Error(copy("There is no remaining quantity to convert.", "रूपांतरण के लिए शेष मात्रा नहीं है।"));
      const body: Record<string, unknown> = {
        documentType: type,
        documentDate: new Date().toISOString().slice(0, 10),
        lines: linesToConvert,
      };
      if (type === "SALES_INVOICE") {
        body.paymentMode = invoicePaymentMode;
        if (invoicePaymentMode === "CASH") body.paymentLedgerId = paymentLedgerId;
      }
      await request(`/api/sales/${id}/convert`, body);
      setMessage(copy("A draft document was created from the source.", "स्रोत से मसौदा दस्तावेज़ बनाया गया।"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not convert the document.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-blue-700">{companyName}</p>
        <h1 className="mt-1 text-2xl font-semibold">{copy("Sales", "बिक्री")}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy("Create quotations and sales orders, fulfill goods through deliveries, and post invoices through the shared voucher and inventory services.", "कोटेशन और बिक्री आदेश बनाएँ, डिलीवरी से माल भेजें और साझा वाउचर व इन्वेंटरी सेवाओं से इनवॉइस पोस्ट करें।")}</p>
      </header>

      {canCreate && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Create quotation or sales order", "कोटेशन या बिक्री आदेश बनाएँ")}</h2>
        {optionsQuery.isLoading ? <p className="mt-3 text-sm text-slate-600">{copy("Loading customers and items…", "ग्राहक और आइटम लोड हो रहे हैं…")}</p>
          : optionsQuery.isError ? <p role="alert" className="mt-3 text-sm text-red-700">{optionsQuery.error.message}</p>
            : <form className="mt-4 space-y-4" onSubmit={createDocument}>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-sm">{copy("Document type", "दस्तावेज़ प्रकार")}
                  <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={newType} onChange={(event) => setNewType(event.target.value as typeof newType)}>
                    <option value="QUOTATION">{copy("Quotation", "कोटेशन")}</option>
                    <option value="SALES_ORDER">{copy("Sales order", "बिक्री आदेश")}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">{copy("Customer", "ग्राहक")}
                  <select required className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={customerId} onChange={(event) => {
                    const selected = customers.find((customer) => customer.id === event.target.value);
                    setCustomerId(event.target.value);
                    setBillingAddressLine1(selected?.addressLine1 ?? "");
                    setShippingAddressLine1(selected?.addressLine1 ?? "");
                  }}>
                    <option value="">{copy("Select customer", "ग्राहक चुनें")}</option>
                    {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">{copy("Date", "तारीख")}<Input required type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} /></label>
              </div>
              {lines.map((line, index) => {
                const selected = items.find((item) => item.id === line.itemId);
                return <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-6">
                  <label className="grid gap-1 text-xs sm:col-span-2">{copy("Item (blank for service)", "आइटम (सेवा के लिए खाली)")}
                    <select className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={line.itemId} onChange={(event) => {
                      const item = items.find((candidate) => candidate.id === event.target.value);
                      setLines((current) => current.map((row, rowIndex) => rowIndex === index ? {
                        ...row, itemId: item?.id ?? "", description: item?.name ?? "", unit: item?.baseUnit.symbol ?? "EA",
                        unitRate: item?.salesRate ?? row.unitRate, gstRate: item?.gstRate ?? row.gstRate,
                        warehouseId: warehouses[0]?.id ?? "", batchNumber: "",
                      } : row));
                    }}>
                      <option value="">{copy("Service / custom line", "सेवा / कस्टम पंक्ति")}</option>
                      {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs">{copy("Description", "विवरण")}<Input required value={line.description} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} /></label>
                  <label className="grid gap-1 text-xs">{copy("Quantity", "मात्रा")}<Input required inputMode="decimal" value={line.quantity} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} /></label>
                  <label className="grid gap-1 text-xs">{copy("Rate", "दर")}<Input required inputMode="decimal" value={line.unitRate} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, unitRate: event.target.value } : row))} /></label>
                  {!selected && <label className="grid gap-1 text-xs">{copy("GST %", "जीएसटी %")}<Input inputMode="decimal" value={line.gstRate} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, gstRate: event.target.value } : row))} /></label>}
                  {selected && <label className="grid gap-1 text-xs">{copy("Godown", "गोदाम")}
                    <select className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={line.warehouseId} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, warehouseId: event.target.value } : row))}>
                      <option value="">{copy("Select godown", "गोदाम चुनें")}</option>
                      {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                  </label>}
                  {selected?.batchTracked && <label className="grid gap-1 text-xs">{copy("Batch", "बैच")}<Input required value={line.batchNumber} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, batchNumber: event.target.value } : row))} /></label>}
                  {lines.length > 1 && <Button type="button" variant="secondary" size="sm" className="self-end" onClick={() => setLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>{copy("Remove", "हटाएँ")}</Button>}
                </div>;
              })}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" onClick={() => setLines((current) => [...current, { itemId: "", description: "", unit: "EA", quantity: "1", unitRate: "0", gstRate: "0", warehouseId: "", batchNumber: "" }])}>{copy("Add line", "पंक्ति जोड़ें")}</Button>
                <span className="text-sm text-slate-600">{copy("Indicative total", "अनुमानित कुल")}: {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(lineTotal)}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">{copy("Billing address", "बिलिंग पता")}<Input value={billingAddressLine1} onChange={(event) => setBillingAddressLine1(event.target.value)} /></label>
                <label className="grid gap-1 text-sm">{copy("Shipping address", "शिपिंग पता")}<Input value={shippingAddressLine1} onChange={(event) => setShippingAddressLine1(event.target.value)} /></label>
                <label className="grid gap-1 text-sm">{copy("Freight", "भाड़ा")}<Input inputMode="decimal" value={freight} onChange={(event) => setFreight(event.target.value)} /></label>
                <label className="grid gap-1 text-sm">{copy("Other charges", "अन्य शुल्क")}<Input inputMode="decimal" value={otherCharges} onChange={(event) => setOtherCharges(event.target.value)} /></label>
                <label className="grid gap-1 text-sm">{copy("Round-off", "राउंड ऑफ")}<Input inputMode="decimal" value={roundOff} onChange={(event) => setRoundOff(event.target.value)} /></label>
              </div>
              <label className="grid gap-1 text-sm">{copy("Notes", "टिप्पणी")}<Input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
              <Button disabled={busy === "create" || !customerId}>{busy === "create" ? copy("Saving…", "सहेज रहे हैं…") : copy("Save draft", "मसौदा सहेजें")}</Button>
            </form>}
      </section>}

      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">{copy("Invoice payment mode", "इनवॉइस भुगतान प्रकार")}
          <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={invoicePaymentMode} onChange={(event) => setInvoicePaymentMode(event.target.value as typeof invoicePaymentMode)}>
            <option value="CREDIT">{copy("Credit", "उधार")}</option><option value="CASH">{copy("Cash / bank", "नकद / बैंक")}</option>
          </select>
        </label>
        {invoicePaymentMode === "CASH" && <label className="grid gap-1 text-sm">{copy("Cash / bank ledger", "नकद / बैंक खाता")}
          <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={paymentLedgerId} onChange={(event) => setPaymentLedgerId(event.target.value)}>
            <option value="">{copy("Select ledger", "खाता चुनें")}</option>
            {(optionsQuery.data?.paymentLedgers ?? []).map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.name}</option>)}
          </select>
        </label>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="text-lg font-semibold">{copy("Sales documents", "बिक्री दस्तावेज़")}</h2><p className="text-sm text-slate-600">{copy("Search, filter and follow the quotation-to-invoice flow.", "कोटेशन से इनवॉइस प्रक्रिया खोजें और देखें।")}</p></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label={copy("Search documents", "दस्तावेज़ खोजें")} placeholder={copy("Number or customer", "नंबर या ग्राहक")} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            <select aria-label={copy("Document type", "दस्तावेज़ प्रकार")} className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={documentType} onChange={(event) => { setDocumentType(event.target.value); setPage(1); }}>
              <option value="">{copy("All document types", "सभी दस्तावेज़ प्रकार")}</option>
              {["QUOTATION", "SALES_ORDER", "DELIVERY_NOTE", "SALES_INVOICE"].map((type) => <option key={type} value={type}>{copy(type.replaceAll("_", " "), type === "QUOTATION" ? "कोटेशन" : type === "SALES_ORDER" ? "बिक्री आदेश" : type === "DELIVERY_NOTE" ? "डिलीवरी नोट" : "बिक्री इनवॉइस")}</option>)}
            </select>
          </div>
        </div>
        {message && <p role="status" className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
        {documentsQuery.isLoading ? <p className="mt-5 text-sm text-slate-600">{copy("Loading sales documents…", "बिक्री दस्तावेज़ लोड हो रहे हैं…")}</p>
          : documentsQuery.isError ? <p role="alert" className="mt-5 text-sm text-red-700">{documentsQuery.error.message}</p>
            : !documentsQuery.data?.documents.length ? <p className="mt-5 rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-600">{copy("No sales documents match these filters.", "इन फ़िल्टरों से कोई बिक्री दस्तावेज़ नहीं मिला।")}</p>
              : <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr>
                    <th className="px-3 py-3">{copy("Document", "दस्तावेज़")}</th><th className="px-3 py-3">{copy("Customer", "ग्राहक")}</th><th className="px-3 py-3">{copy("Date", "तारीख")}</th><th className="px-3 py-3">{copy("Total", "कुल")}</th><th className="px-3 py-3">{copy("Status", "स्थिति")}</th><th className="px-3 py-3">{copy("Actions", "कार्रवाई")}</th>
                  </tr></thead>
                  <tbody>{documentsQuery.data.documents.map((doc) => <tr key={doc.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-3"><Link className="font-semibold text-blue-700 hover:underline" href={`/dashboard/sales/${doc.id}`}>{doc.documentNumber}</Link><p className="text-xs text-slate-500">{doc.documentType.replaceAll("_", " ")}{doc.sourceDocument ? ` · ${copy("from", "से")} ${doc.sourceDocument.documentNumber}` : ""}</p></td>
                    <td className="px-3 py-3">{doc.party.name}</td><td className="px-3 py-3">{new Date(doc.documentDate).toLocaleDateString(locale === "HI" ? "hi-IN" : "en-IN")}</td>
                    <td className="px-3 py-3">{new Intl.NumberFormat(locale === "HI" ? "hi-IN" : "en-IN", { style: "currency", currency: "INR" }).format(Number(doc.totalAmount))}</td>
                    <td className="px-3 py-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{doc.status}</span></td>
                    <td className="px-3 py-3"><div className="flex flex-wrap gap-2">
                      {canIssue && doc.status === "DRAFT" && <Button size="sm" disabled={busy === doc.id} onClick={() => void doAction(doc.id, "transition", { action: "ISSUE" })}>{copy("Issue", "जारी करें")}</Button>}
                      {canIssue && doc.documentType === "QUOTATION" && doc.status === "ISSUED" && <Button size="sm" disabled={busy === doc.id} onClick={() => void doAction(doc.id, "transition", { action: "ACCEPT" })}>{copy("Accept", "स्वीकारें")}</Button>}
                      {canCreate && doc.documentType === "QUOTATION" && doc.status === "ACCEPTED" && <Button size="sm" disabled={busy === doc.id} onClick={() => void convert(doc.id, "SALES_ORDER")}>{copy("Create order", "आदेश बनाएँ")}</Button>}
                      {canCreate && doc.documentType === "SALES_ORDER" && ["ISSUED", "ACCEPTED", "PARTIALLY_DELIVERED"].includes(doc.status) && warehouses.length > 0 && <Button size="sm" variant="secondary" disabled={busy === doc.id} onClick={() => void convert(doc.id, "DELIVERY_NOTE")}>{copy("Create delivery", "डिलीवरी बनाएँ")}</Button>}
                      {canCreate && ["SALES_ORDER", "DELIVERY_NOTE"].includes(doc.documentType) && ["ISSUED", "ACCEPTED", "PARTIALLY_DELIVERED", "DELIVERED", "POSTED", "PARTIALLY_INVOICED"].includes(doc.status) && <Button size="sm" variant="secondary" disabled={busy === doc.id} onClick={() => void convert(doc.id, "SALES_INVOICE")}>{copy("Create invoice", "इनवॉइस बनाएँ")}</Button>}
                      {canPost && ["DELIVERY_NOTE", "SALES_INVOICE"].includes(doc.documentType) && doc.status === "DRAFT" && <Button size="sm" disabled={busy === doc.id} onClick={() => void doAction(doc.id, "post")}>{copy("Post", "पोस्ट करें")}</Button>}
                      {doc.documentType === "SALES_INVOICE" && doc.status === "POSTED" && <Button asChild size="sm" variant="secondary"><Link href={`/dashboard/sales/${doc.id}/print`}>{copy("Print", "प्रिंट")}</Link></Button>}
                      {canSend && ["ISSUED", "ACCEPTED", "POSTED"].includes(doc.status) && <Button size="sm" variant="ghost" disabled={busy === doc.id} onClick={() => void doAction(doc.id, "send", { channel: "EMAIL" })}>{copy("Email", "ईमेल")}</Button>}
                      {canSend && ["ISSUED", "ACCEPTED", "POSTED"].includes(doc.status) && <Button size="sm" variant="ghost" disabled={busy === doc.id} onClick={() => void doAction(doc.id, "send", { channel: "WHATSAPP" })}>{copy("WhatsApp", "व्हाट्सऐप")}</Button>}
                      {canCancel && doc.status !== "CANCELLED" && doc.status !== "REVERSED" && <Button size="sm" variant="ghost" disabled={busy === doc.id} onClick={() => {
                        const reason = window.prompt(copy("Reason for cancellation or reversal", "रद्द करने या रिवर्स करने का कारण"));
                        if (reason?.trim()) void doAction(doc.id, "cancel", { reason, reversalDate: new Date().toISOString().slice(0, 10) });
                      }}>{copy("Cancel", "रद्द करें")}</Button>}
                    </div></td>
                  </tr>)}</tbody>
                </table>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span>{copy("Page", "पृष्ठ")} {page} / {pages} · {documentsQuery.data.total} {copy("documents", "दस्तावेज़")}</span>
                  <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button></div>
                </div>
              </div>}
      </section>
    </div>
  );
}
