"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { purchaseDocumentCreateSchema } from "@/lib/validation/purchases";
import { z } from "zod";

const listSchema = z.object({ success: z.literal(true), data: z.object({
  documents: z.array(z.object({ id: z.string(), documentNumber: z.string(), documentType: z.string(), status: z.string(),
    documentDate: z.string(), supplierInvoiceNumber: z.string().nullable(), totalAmount: z.string(),
    party: z.object({ id: z.string(), name: z.string() }),
    sourceDocument: z.object({ id: z.string(), documentNumber: z.string(), documentType: z.string() }).nullable(),
    voucher: z.object({ voucherNumber: z.string() }).nullable() })), total: z.number(), page: z.number(), pageSize: z.number(),
}) });
const optionsSchema = z.object({ success: z.literal(true), data: z.object({
  suppliers: z.array(z.object({ id: z.string(), name: z.string(), stateCode: z.string().nullable(), creditPeriodDays: z.number() })),
  items: z.array(z.object({ id: z.string(), name: z.string(), hsnSac: z.string().nullable(), gstRate: z.string(), purchaseRate: z.string(), batchTracked: z.boolean(), baseUnit: z.object({ symbol: z.string() }) })),
  warehouses: z.array(z.object({ id: z.string(), name: z.string() })),
  paymentLedgers: z.array(z.object({ id: z.string(), name: z.string(), type: z.enum(["CASH", "BANK"]) })),
  costCentres: z.array(z.object({ id: z.string(), name: z.string() })),
}) });

type DraftLine = { itemId: string; description: string; unit: string; quantity: string; unitRate: string; gstRate: string; warehouseId: string; batchNumber: string; expiryDate: string; costCentreId: string };
const blankLine = (): DraftLine => ({ itemId: "", description: "", unit: "EA", quantity: "1", unitRate: "0", gstRate: "0", warehouseId: "", batchNumber: "", expiryDate: "", costCentreId: "" });

export function PurchasesManager({ locale, companyName, canCreate, canIssue, canPost, canCancel }: {
  locale: Locale; companyName: string; canCreate: boolean; canIssue: boolean; canPost: boolean; canCancel: boolean;
}) {
  const queryClient = useQueryClient();
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const [search, setSearch] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [page, setPage] = useState(1);
  const [supplierId, setSupplierId] = useState("");
  const [newType, setNewType] = useState<"PURCHASE_ORDER" | "PURCHASE_INVOICE">("PURCHASE_ORDER");
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceReference, setInvoiceReference] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [freight, setFreight] = useState("0");
  const [paymentMode, setPaymentMode] = useState<"CREDIT" | "CASH">("CREDIT");
  const [paymentLedgerId, setPaymentLedgerId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const documentsQuery = useQuery({
    queryKey: ["purchase-documents", search, documentType, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search) params.set("search", search);
      if (documentType) params.set("documentType", documentType);
      const response = await fetch(`/api/purchases?${params}`);
      if (!response.ok) throw new Error("Could not load purchase documents.");
      return listSchema.parse(await response.json()).data;
    },
  });
  const optionsQuery = useQuery({
    queryKey: ["purchase-options"],
    queryFn: async () => {
      const response = await fetch("/api/purchases/options");
      if (!response.ok) throw new Error("Could not load suppliers, stock items and godowns.");
      return optionsSchema.parse(await response.json()).data;
    },
  });
  const suppliers = optionsQuery.data?.suppliers ?? [];
  const items = optionsQuery.data?.items ?? [];
  const warehouses = optionsQuery.data?.warehouses ?? [];
  const pages = Math.max(1, Math.ceil((documentsQuery.data?.total ?? 0) / 20));

  async function request(path: string, body?: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as { success: boolean; error?: { message?: string } };
    if (!response.ok || !result.success) throw new Error(result.error?.message ?? "The purchase action failed.");
    await queryClient.invalidateQueries({ queryKey: ["purchase-documents"] });
    return result;
  }

  async function createDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId);
    const payload = {
      documentType: newType, partyId: supplierId, documentDate,
      ...(newType === "PURCHASE_INVOICE" ? { supplierInvoiceNumber: invoiceReference, supplierInvoiceDate: invoiceDate, paymentMode, ...(paymentMode === "CASH" ? { paymentLedgerId } : {}) } : {}),
      freight,
      lines: lines.map((line) => {
        const item = items.find((candidate) => candidate.id === line.itemId);
        return { ...(line.itemId ? { itemId: line.itemId } : {}), description: line.description || item?.name || "Service",
          unit: item?.baseUnit.symbol ?? line.unit, quantity: line.quantity, unitRate: line.unitRate,
          gstRate: line.gstRate || item?.gstRate || "0", ...(line.itemId ? { warehouseId: line.warehouseId, batchNumber: line.batchNumber, expiryDate: line.expiryDate } : {}),
          ...(line.costCentreId ? { costCentreId: line.costCentreId } : {}) };
      }),
    };
    const parsed = purchaseDocumentCreateSchema.safeParse(payload);
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Check the purchase details."); return; }
    if (!selectedSupplier) { setMessage("Select a supplier from this company."); return; }
    setBusy("create");
    try {
      await request("/api/purchases", parsed.data);
      setMessage(copy("Draft saved. Issue the order or post the invoice when ready.", "मसौदा सहेजा गया। तैयार होने पर आदेश जारी करें या इनवॉइस पोस्ट करें।"));
      setInvoiceReference(""); setFreight("0"); setLines([blankLine()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the purchase document."); }
    finally { setBusy(""); }
  }

  async function act(id: string, action: string, body?: unknown) {
    setBusy(id); setMessage("");
    try { await request(`/api/purchases/${id}/${action}`, body); setMessage(copy("Purchase document updated.", "खरीद दस्तावेज़ अपडेट हुआ।")); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The purchase action failed."); }
    finally { setBusy(""); }
  }

  async function convert(id: string, target: "RECEIPT_NOTE" | "PURCHASE_INVOICE" | "PURCHASE_RETURN") {
    setBusy(id); setMessage("");
    try {
      const response = await fetch(`/api/purchases/${id}`);
      const result = await response.json() as { success: boolean; data?: { document?: { documentType: string; lines: Array<{ id: string; quantity: string; receivedQuantity: string; invoicedQuantity: string; itemId: string | null; warehouseId: string | null; batchNumber: string | null; expiryDate: string | null }> } }; error?: { message?: string } };
      if (!response.ok || !result.success || !result.data?.document) throw new Error(result.error?.message ?? "Could not load the source document.");
      const sourceLines = result.data.document.lines;
      if (target === "PURCHASE_INVOICE" && result.data.document.documentType === "PURCHASE_ORDER" &&
        sourceLines.some((line) => Number(line.receivedQuantity) > Number(line.invoicedQuantity))) {
        throw new Error("Invoice received quantities from the receipt note before invoicing the remaining order.");
      }
      const converted = sourceLines.map((line) => {
        const alreadyAllocated = result.data!.document!.documentType === "PURCHASE_ORDER"
          ? Math.max(Number(line.receivedQuantity), Number(line.invoicedQuantity)) : Number(line.invoicedQuantity);
        const remaining = target === "RECEIPT_NOTE" ? Number(line.quantity) - Number(line.receivedQuantity)
          : target === "PURCHASE_INVOICE" ? Number(line.quantity) - alreadyAllocated : Number(line.quantity);
        return { sourceLineId: line.id, quantity: String(remaining), ...(line.itemId ? { warehouseId: line.warehouseId ?? warehouses[0]?.id, batchNumber: line.batchNumber ?? "", expiryDate: line.expiryDate?.slice(0, 10) ?? "" } : {}) };
      }).filter((line) => Number(line.quantity) > 0);
      if (!converted.length) throw new Error("There is no remaining quantity to convert.");
      const body: Record<string, unknown> = { documentType: target, documentDate: new Date().toISOString().slice(0, 10), lines: converted };
      if (target === "PURCHASE_INVOICE") {
        const reference = window.prompt("Supplier invoice number");
        if (!reference?.trim()) throw new Error("Supplier invoice number is required.");
        body.supplierInvoiceNumber = reference.trim(); body.supplierInvoiceDate = body.documentDate; body.paymentMode = paymentMode;
        if (paymentMode === "CASH") body.paymentLedgerId = paymentLedgerId;
      }
      await request(`/api/purchases/${id}/convert`, body);
      setMessage(copy("A draft was created from the source document.", "स्रोत दस्तावेज़ से मसौदा बनाया गया।"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not convert the document."); }
    finally { setBusy(""); }
  }

  return <div className="space-y-6">
    <header>
      <p className="text-sm font-medium text-blue-700">{companyName}</p>
      <h1 className="mt-1 text-2xl font-semibold">{copy("Purchases", "खरीद")}</h1>
    </header>
    {canCreate && <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">{copy("Create purchase order or invoice", "खरीद आदेश या इनवॉइस बनाएँ")}</h2>
      {optionsQuery.isLoading ? <p className="mt-3 text-sm text-slate-600">{copy("Loading suppliers and stock…", "आपूर्तिकर्ता और स्टॉक लोड हो रहे हैं…")}</p>
        : optionsQuery.isError ? <p role="alert" className="mt-3 text-sm text-red-700">{optionsQuery.error.message}</p>
          : <form className="mt-4 space-y-4" onSubmit={createDocument}>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">{copy("Document type", "दस्तावेज़ प्रकार")}
                <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={newType} onChange={(event) => setNewType(event.target.value as typeof newType)}>
                  <option value="PURCHASE_ORDER">{copy("Purchase order", "खरीद आदेश")}</option><option value="PURCHASE_INVOICE">{copy("Purchase invoice", "खरीद इनवॉइस")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">{copy("Supplier", "आपूर्तिकर्ता")}
                <select required className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                  <option value="">{copy("Select supplier", "आपूर्तिकर्ता चुनें")}</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">{copy("Document date", "दस्तावेज़ की तारीख")}<Input required type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} /></label>
              {newType === "PURCHASE_INVOICE" && <>
                <label className="grid gap-1 text-sm">{copy("Supplier invoice reference", "आपूर्तिकर्ता इनवॉइस संदर्भ")}<Input required value={invoiceReference} onChange={(event) => setInvoiceReference(event.target.value)} /></label>
                <label className="grid gap-1 text-sm">{copy("Supplier invoice date", "आपूर्तिकर्ता इनवॉइस तारीख")}<Input required type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
                <label className="grid gap-1 text-sm">{copy("Payment", "भुगतान")}
                  <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as typeof paymentMode)}><option value="CREDIT">{copy("Credit", "उधार")}</option><option value="CASH">{copy("Cash / bank", "नकद / बैंक")}</option></select>
                </label>
                {paymentMode === "CASH" && <label className="grid gap-1 text-sm">{copy("Cash / bank ledger", "नकद / बैंक खाता")}
                  <select required className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={paymentLedgerId} onChange={(event) => setPaymentLedgerId(event.target.value)}><option value="">{copy("Select ledger", "खाता चुनें")}</option>{(optionsQuery.data?.paymentLedgers ?? []).map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.name}</option>)}</select>
                </label>}
              </>}
            </div>
            {lines.map((line, index) => {
              const selected = items.find((item) => item.id === line.itemId);
              return <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-4 lg:grid-cols-7">
                <label className="grid gap-1 text-xs sm:col-span-2">{copy("Stock item (blank for service)", "स्टॉक आइटम (सेवा के लिए खाली)")}
                  <select className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={line.itemId} onChange={(event) => {
                    const item = items.find((candidate) => candidate.id === event.target.value);
                    setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, itemId: item?.id ?? "", description: item?.name ?? "", unit: item?.baseUnit.symbol ?? "EA", unitRate: item?.purchaseRate ?? row.unitRate, gstRate: item?.gstRate ?? row.gstRate, warehouseId: warehouses[0]?.id ?? "" } : row));
                  }}><option value="">{copy("Service / custom line", "सेवा / कस्टम पंक्ति")}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                </label>
                <label className="grid gap-1 text-xs">{copy("Description", "विवरण")}<Input required value={line.description} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} /></label>
                <label className="grid gap-1 text-xs">{copy("Quantity", "मात्रा")}<Input required inputMode="decimal" value={line.quantity} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} /></label>
                <label className="grid gap-1 text-xs">{copy("Rate", "दर")}<Input required inputMode="decimal" value={line.unitRate} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, unitRate: event.target.value } : row))} /></label>
                {selected && <label className="grid gap-1 text-xs">{copy("Godown", "गोदाम")}<select className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={line.warehouseId} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, warehouseId: event.target.value } : row))}><option value="">{copy("Select", "चुनें")}</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>}
                {selected?.batchTracked && <label className="grid gap-1 text-xs">{copy("Batch", "बैच")}<Input required value={line.batchNumber} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, batchNumber: event.target.value } : row))} /></label>}
                {selected?.batchTracked && <label className="grid gap-1 text-xs">{copy("Expiry", "समाप्ति")}<Input type="date" value={line.expiryDate} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, expiryDate: event.target.value } : row))} /></label>}
                {optionsQuery.data?.costCentres.length ? <label className="grid gap-1 text-xs">{copy("Cost centre", "लागत केंद्र")}<select className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={line.costCentreId} onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, costCentreId: event.target.value } : row))}><option value="">{copy("None", "कोई नहीं")}</option>{optionsQuery.data.costCentres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}</select></label> : null}
                {lines.length > 1 && <Button type="button" variant="secondary" size="sm" className="self-end" onClick={() => setLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>{copy("Remove", "हटाएँ")}</Button>}
              </div>;
            })}
            <div className="flex flex-wrap items-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setLines((current) => [...current, blankLine()])}>{copy("Add line", "पंक्ति जोड़ें")}</Button>
              <label className="grid gap-1 text-sm">{copy("Freight / landed cost", "भाड़ा / लैंडेड लागत")}<Input inputMode="decimal" value={freight} onChange={(event) => setFreight(event.target.value)} /></label>
              <Button disabled={busy === "create" || !supplierId}>{busy === "create" ? copy("Saving…", "सहेज रहे हैं…") : copy("Save draft", "मसौदा सहेजें")}</Button>
            </div>
          </form>}
    </section>}
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="text-lg font-semibold">{copy("Purchase documents", "खरीद दस्तावेज़")}</h2></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label={copy("Search purchases", "खरीद खोजें")} placeholder={copy("Number, supplier or invoice reference", "नंबर, आपूर्तिकर्ता या इनवॉइस संदर्भ")} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          <select aria-label={copy("Filter document type", "दस्तावेज़ प्रकार फ़िल्टर करें")} className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={documentType} onChange={(event) => { setDocumentType(event.target.value); setPage(1); }}><option value="">{copy("All document types", "सभी दस्तावेज़ प्रकार")}</option>{["PURCHASE_ORDER", "RECEIPT_NOTE", "PURCHASE_INVOICE", "PURCHASE_RETURN"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select>
        </div>
      </div>
      {message && <p role="status" className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
      {documentsQuery.isLoading ? <p className="mt-5 text-sm text-slate-600">{copy("Loading purchases…", "खरीद लोड हो रही है…")}</p>
        : documentsQuery.isError ? <p role="alert" className="mt-5 text-sm text-red-700">{documentsQuery.error.message}</p>
          : !documentsQuery.data?.documents.length ? <p className="mt-5 rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-600">{copy("No purchase documents match these filters.", "इन फ़िल्टरों से कोई खरीद दस्तावेज़ नहीं मिला।")}</p>
            : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-3 pr-3">{copy("Document", "दस्तावेज़")}</th><th className="py-3 pr-3">{copy("Supplier", "आपूर्तिकर्ता")}</th><th className="py-3 pr-3">{copy("Supplier reference", "आपूर्तिकर्ता संदर्भ")}</th><th className="py-3 pr-3">{copy("Date", "तारीख")}</th><th className="py-3 pr-3">{copy("Total", "कुल")}</th><th className="py-3 pr-3">{copy("Status", "स्थिति")}</th><th className="py-3">{copy("Actions", "कार्रवाई")}</th></tr></thead>
              <tbody>{documentsQuery.data.documents.map((doc) => <tr key={doc.id} className="border-b last:border-0"><td className="py-3 pr-3"><span className="font-medium">{doc.documentNumber}</span><span className="block text-xs text-slate-500">{doc.documentType.replaceAll("_", " ")}{doc.sourceDocument ? ` · from ${doc.sourceDocument.documentNumber}` : ""}</span></td><td className="py-3 pr-3">{doc.party.name}</td><td className="py-3 pr-3">{doc.supplierInvoiceNumber ?? "—"}</td><td className="py-3 pr-3">{new Date(doc.documentDate).toLocaleDateString(locale === "HI" ? "hi-IN" : "en-IN")}</td><td className="py-3 pr-3">{new Intl.NumberFormat(locale === "HI" ? "hi-IN" : "en-IN", { style: "currency", currency: "INR" }).format(Number(doc.totalAmount))}</td><td className="py-3 pr-3">{doc.status.replaceAll("_", " ")}{doc.voucher ? <span className="block text-xs text-slate-500">{doc.voucher.voucherNumber}</span> : null}</td><td className="py-3"><div className="flex flex-wrap gap-1">
                {canIssue && doc.documentType === "PURCHASE_ORDER" && doc.status === "DRAFT" && <Button size="sm" variant="secondary" disabled={busy === doc.id} onClick={() => act(doc.id, "issue")}>{copy("Issue", "जारी करें")}</Button>}
                {canCreate && doc.documentType === "PURCHASE_ORDER" && ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "PARTIALLY_INVOICED"].includes(doc.status) && <><Button size="sm" variant="secondary" disabled={busy === doc.id} onClick={() => convert(doc.id, "RECEIPT_NOTE")}>{copy("Receive", "प्राप्त करें")}</Button><Button size="sm" variant="secondary" disabled={busy === doc.id} onClick={() => convert(doc.id, "PURCHASE_INVOICE")}>{copy("Invoice", "इनवॉइस")}</Button></>}
                {canCreate && doc.documentType === "RECEIPT_NOTE" && doc.status === "POSTED" && <Button size="sm" variant="secondary" disabled={busy === doc.id} onClick={() => convert(doc.id, "PURCHASE_INVOICE")}>{copy("Invoice", "इनवॉइस")}</Button>}
                {canCreate && doc.documentType === "PURCHASE_INVOICE" && doc.status === "POSTED" && <Button size="sm" variant="secondary" disabled={busy === doc.id} onClick={() => convert(doc.id, "PURCHASE_RETURN")}>{copy("Return", "वापसी")}</Button>}
                {canPost && doc.status === "DRAFT" && doc.documentType !== "PURCHASE_ORDER" && <Button size="sm" disabled={busy === doc.id} onClick={() => act(doc.id, "post", { paymentMode, ...(paymentMode === "CASH" ? { paymentLedgerId } : {}) })}>{copy("Post", "पोस्ट करें")}</Button>}
                {canCancel && ["DRAFT", "ORDERED", "POSTED"].includes(doc.status) && <Button size="sm" variant="secondary" disabled={busy === doc.id} onClick={() => {
                  const reason = window.prompt("Reason for cancellation or reversal"); if (!reason || reason.trim().length < 5) return;
                  void act(doc.id, "cancel", { reason, reversalDate: new Date().toISOString().slice(0, 10) });
                }}>{copy("Cancel", "रद्द करें")}</Button>}
              </div></td></tr>)}</tbody></table></div>}
      {documentsQuery.data && documentsQuery.data.total > 0 && <div className="mt-4 flex items-center justify-between text-sm"><span>{copy(`Page ${page} of ${pages} · ${documentsQuery.data.total} documents`, `पृष्ठ ${page}/${pages} · ${documentsQuery.data.total} दस्तावेज़`)}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button><Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button></div></div>}
    </section>
  </div>;
}
