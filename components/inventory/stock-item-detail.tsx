"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { stockItemUpdateSchema } from "@/lib/validation/inventory";

const dateSchema = z.string().nullable();
const itemSchema = z.object({
  id: z.string(), name: z.string(), code: z.string().nullable(), hsnSac: z.string().nullable(),
  gstRate: z.string(), purchaseRate: z.string(), salesRate: z.string(), mrp: z.string().nullable(),
  reorderLevel: z.string(), minimumLevel: z.string(), maximumLevel: z.string().nullable(),
  batchTracked: z.boolean(), barcode: z.string().nullable(), isActive: z.boolean(),
  group: z.object({ id: z.string(), name: z.string(), code: z.string() }),
  baseUnit: z.object({ id: z.string(), name: z.string(), symbol: z.string(), precision: z.number() }),
  alternateUnits: z.array(z.object({
    id: z.string(), baseQuantity: z.string(), barcode: z.string().nullable(),
    unit: z.object({ id: z.string(), name: z.string(), symbol: z.string(), precision: z.number() }),
  })),
  balances: z.array(z.object({
    id: z.string(), quantity: z.string(), value: z.string(),
    warehouse: z.object({ id: z.string(), name: z.string(), code: z.string() }),
    batch: z.object({ id: z.string(), batchNumber: z.string(), manufacturingDate: dateSchema, expiryDate: dateSchema }).nullable(),
  })),
  batches: z.array(z.object({ id: z.string(), batchNumber: z.string(), manufacturingDate: dateSchema, expiryDate: dateSchema })),
});
const detailResponseSchema = z.object({ success: z.literal(true), data: z.object({ item: itemSchema }) });
const movementResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    movements: z.array(z.object({
      id: z.string(), movementType: z.string(), direction: z.string(), quantity: z.string(),
      unitCost: z.string(), value: z.string(), movementDate: z.string(), idempotencyKey: z.string(),
      warehouse: z.object({ id: z.string(), name: z.string(), code: z.string() }),
      batch: z.object({ id: z.string(), batchNumber: z.string(), expiryDate: dateSchema }).nullable(),
      voucher: z.object({ id: z.string(), voucherNumber: z.string(), type: z.string() }).nullable(),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});
const editFormSchema = z.object({
  name: z.string().trim().min(2).max(160),
  hsnSac: z.string().trim().toUpperCase().regex(/^(?:[A-Z0-9]{4,8})?$/),
  gstRate: z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/).refine((value) => Number(value) <= 100),
  purchaseRate: z.string().regex(/^\d{1,12}(?:\.\d{1,4})?$/),
  salesRate: z.string().regex(/^\d{1,12}(?:\.\d{1,4})?$/),
  mrp: z.string().regex(/^(?:\d{1,12}(?:\.\d{1,4})?)?$/),
  minimumLevel: z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/),
  reorderLevel: z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/),
  maximumLevel: z.string().regex(/^(?:\d{1,12}(?:\.\d{1,6})?)?$/),
  isActive: z.boolean(),
}).refine((value) => Number(value.reorderLevel) >= Number(value.minimumLevel), {
  message: "Reorder level cannot be below minimum level",
  path: ["reorderLevel"],
}).refine((value) => !value.maximumLevel || Number(value.maximumLevel) >= Number(value.reorderLevel), {
  message: "Maximum level cannot be below reorder level",
  path: ["maximumLevel"],
});
type EditValues = z.infer<typeof editFormSchema>;

export function StockItemDetail({ itemId, locale, canUpdate, canReadMovements }: {
  itemId: string; locale: Locale; canUpdate: boolean; canReadMovements: boolean;
}) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const itemQuery = useQuery({
    queryKey: ["inventory-item", itemId],
    queryFn: async () => {
      const response = await fetch(`/api/inventory/items/${itemId}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load stock item.");
      return detailResponseSchema.parse(body).data.item;
    },
  });
  const movementQuery = useQuery({
    queryKey: ["inventory-movements", itemId, page],
    enabled: canReadMovements,
    queryFn: async () => {
      const params = new URLSearchParams({ itemId, page: String(page), pageSize: "20" });
      const response = await fetch(`/api/inventory/movements?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load movement history.");
      return movementResponseSchema.parse(body).data;
    },
  });
  const form = useForm<EditValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: { name: "", hsnSac: "", gstRate: "0", purchaseRate: "0", salesRate: "0", mrp: "", minimumLevel: "0", reorderLevel: "0", maximumLevel: "", isActive: true },
  });
  useEffect(() => {
    if (itemQuery.data) form.reset({
      name: itemQuery.data.name, hsnSac: itemQuery.data.hsnSac ?? "",
      gstRate: itemQuery.data.gstRate, purchaseRate: itemQuery.data.purchaseRate,
      salesRate: itemQuery.data.salesRate,       mrp: itemQuery.data.mrp ?? "",
      minimumLevel: itemQuery.data.minimumLevel, reorderLevel: itemQuery.data.reorderLevel,
      maximumLevel: itemQuery.data.maximumLevel ?? "", isActive: itemQuery.data.isActive,
    });
  }, [form, itemQuery.data]);
  const save = useMutation({
    mutationFn: async (values: EditValues) => {
      const parsed = editFormSchema.parse(values);
      const input = stockItemUpdateSchema.parse({
        ...parsed,
        hsnSac: parsed.hsnSac || null,
        mrp: parsed.mrp || null,
        maximumLevel: parsed.maximumLevel || null,
      });
      const response = await fetch(`/api/inventory/items/${itemId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update stock item.");
    },
    onSuccess: async () => {
      setEditing(false);
      setMessage(copy("Stock item settings saved.", "स्टॉक आइटम सेटिंग सहेजी गई।"));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["inventory-item", itemId] }),
        client.invalidateQueries({ queryKey: ["inventory-items"] }),
        client.invalidateQueries({ queryKey: ["inventory-report"] }),
      ]);
    },
  });
  const item = itemQuery.data;
  const pageCount = Math.max(1, Math.ceil((movementQuery.data?.total ?? 0) / 20));
  const currency = (value: string) => new Intl.NumberFormat(locale === "HI" ? "hi-IN" : "en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value));
  const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString(locale === "HI" ? "hi-IN" : "en-IN") : "—";
  return <div className="space-y-6">
    <Link href="/dashboard/inventory" className="text-sm font-medium text-blue-700 hover:underline">← {copy("Back to stock items", "स्टॉक आइटम पर वापस जाएँ")}</Link>
    {itemQuery.isPending && <p role="status" className="py-8">{copy("Loading item details…", "आइटम विवरण लोड हो रहा है…")}</p>}
    {itemQuery.isError && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{itemQuery.error.message}</p>}
    {item && <>
      <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{item.name}</h1><p className="mt-2 text-sm text-slate-600">{item.code ?? "—"} · {item.group.name} · {item.baseUnit.name} ({item.baseUnit.symbol}) · {item.isActive ? copy("Active", "सक्रिय") : copy("Inactive", "निष्क्रिय")}</p></div>{canUpdate && <Button variant="secondary" onClick={() => { setMessage(""); setEditing((value) => !value); }}>{copy(editing ? "Cancel edit" : "Edit settings", editing ? "संपादन रद्द करें" : "सेटिंग संपादित करें")}</Button>}</header>
      {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
      {editing && <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{copy("Item settings", "आइटम सेटिंग")}</h2><form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <label className="grid gap-1 text-sm">{copy("Name", "नाम")}<Input {...form.register("name")} /></label>
        <label className="grid gap-1 text-sm">{copy("HSN / SAC", "एचएसएन / एसएसी")}<Input {...form.register("hsnSac")} /></label>
        <label className="grid gap-1 text-sm">{copy("GST rate (%)", "जीएसटी दर (%)")}<Input inputMode="decimal" {...form.register("gstRate")} /></label>
        <label className="grid gap-1 text-sm">{copy("Purchase rate", "खरीद दर")}<Input inputMode="decimal" {...form.register("purchaseRate")} /></label>
        <label className="grid gap-1 text-sm">{copy("Sales rate", "बिक्री दर")}<Input inputMode="decimal" {...form.register("salesRate")} /></label>
        <label className="grid gap-1 text-sm">{copy("MRP", "एमआरपी")}<Input inputMode="decimal" {...form.register("mrp")} /></label>
        <label className="grid gap-1 text-sm">{copy("Minimum level", "न्यूनतम स्तर")}<Input inputMode="decimal" {...form.register("minimumLevel")} /></label>
        <label className="grid gap-1 text-sm">{copy("Reorder level", "पुनः-आदेश स्तर")}<Input inputMode="decimal" {...form.register("reorderLevel")} /></label>
        <label className="grid gap-1 text-sm">{copy("Maximum level", "अधिकतम स्तर")}<Input inputMode="decimal" {...form.register("maximumLevel")} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("isActive")} />{copy("Active", "सक्रिय")}</label>
        {Object.values(form.formState.errors).map((error, index) => error?.message && <p key={index} role="alert" className="text-sm text-red-700">{error.message}</p>)}
        {save.isError && <p role="alert" className="text-sm text-red-700">{save.error.message}</p>}
        <div className="flex items-center gap-3"><Button disabled={save.isPending}>{copy(save.isPending ? "Saving…" : "Save settings", save.isPending ? "सहेजा जा रहा है…" : "सेटिंग सहेजें")}</Button></div>
      </form></section>}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
        [copy("Purchase rate", "खरीद दर"), currency(item.purchaseRate)],
        [copy("Sales rate", "बिक्री दर"), currency(item.salesRate)],
        [copy("GST", "जीएसटी"), `${item.gstRate}%`],
        [copy("HSN / SAC", "एचएसएन / एसएसी"), item.hsnSac ?? "—"],
      ].map(([label, value]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold">{value}</p></article>)}</section>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{copy("Alternate units and barcodes", "वैकल्पिक इकाइयाँ और बारकोड")}</h2>{item.alternateUnits.length === 0 ? <p className="py-5 text-sm text-slate-500">{copy("No alternate units configured.", "कोई वैकल्पिक इकाई निर्धारित नहीं है।")}</p> : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-3">{copy("Unit", "इकाई")}</th><th className="p-3">{copy("Base quantity per unit", "प्रति इकाई मूल मात्रा")}</th><th className="p-3">{copy("Barcode", "बारकोड")}</th></tr></thead><tbody>{item.alternateUnits.map((conversion) => <tr key={conversion.id} className="border-b last:border-0"><td className="p-3">{conversion.unit.name} ({conversion.unit.symbol})</td><td className="p-3">{conversion.baseQuantity}</td><td className="p-3">{conversion.barcode ?? "—"}</td></tr>)}</tbody></table></div>}</section>
      <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{copy("Godown and batch balances", "गोदाम और बैच शेष")}</h2>{item.balances.length === 0 && <p className="py-5 text-sm text-slate-500">{copy("No stock balances recorded.", "कोई स्टॉक शेष दर्ज नहीं है।")}</p>}{item.balances.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-3">{copy("Godown", "गोदाम")}</th><th className="p-3">{copy("Batch", "बैच")}</th><th className="p-3">{copy("Manufactured", "निर्मित")}</th><th className="p-3">{copy("Expiry", "समाप्ति")}</th><th className="p-3">{copy("Quantity", "मात्रा")}</th><th className="p-3">{copy("Value", "मूल्य")}</th></tr></thead><tbody>{item.balances.map((balance) => <tr key={balance.id} className="border-b last:border-0"><td className="p-3">{balance.warehouse.name}</td><td className="p-3">{balance.batch?.batchNumber ?? copy("Unbatched", "बिना बैच")}</td><td className="p-3">{formatDate(balance.batch?.manufacturingDate ?? null)}</td><td className="p-3">{formatDate(balance.batch?.expiryDate ?? null)}</td><td className="p-3">{balance.quantity} {item.baseUnit.symbol}</td><td className="p-3">{currency(balance.value)}</td></tr>)}</tbody></table></div>}</section>
      {canReadMovements && <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{copy("Stock movement history", "स्टॉक गतिविधि इतिहास")}</h2>{movementQuery.isPending && <p role="status" className="py-6">{copy("Loading movements…", "गतिविधियाँ लोड हो रही हैं…")}</p>}{movementQuery.isError && <p role="alert" className="py-5 text-sm text-red-700">{movementQuery.error.message}</p>}{movementQuery.data && movementQuery.data.movements.length === 0 && <p className="py-5 text-sm text-slate-500">{copy("No movements recorded.", "कोई गतिविधि दर्ज नहीं है।")}</p>}{movementQuery.data && movementQuery.data.movements.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-3">{copy("Date", "तिथि")}</th><th className="p-3">{copy("Movement", "गतिविधि")}</th><th className="p-3">{copy("Godown / batch", "गोदाम / बैच")}</th><th className="p-3">{copy("Quantity", "मात्रा")}</th><th className="p-3">{copy("Unit cost", "इकाई लागत")}</th><th className="p-3">{copy("Value", "मूल्य")}</th><th className="p-3">{copy("Voucher", "वाउचर")}</th></tr></thead><tbody>{movementQuery.data.movements.map((movement) => <tr key={movement.id} className="border-b last:border-0"><td className="p-3">{formatDate(movement.movementDate)}</td><td className="p-3">{movement.movementType} · {movement.direction}</td><td className="p-3">{movement.warehouse.name}{movement.batch ? ` / ${movement.batch.batchNumber}` : ""}</td><td className="p-3">{movement.direction === "IN" ? "+" : "−"}{movement.quantity} {item.baseUnit.symbol}</td><td className="p-3">{currency(movement.unitCost)}</td><td className="p-3">{currency(movement.value)}</td><td className="p-3">{movement.voucher?.voucherNumber ?? "—"}</td></tr>)}</tbody></table></div>}<div className="mt-4 flex items-center justify-between"><Button variant="secondary" disabled={page <= 1 || movementQuery.isPending} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button><span className="text-sm text-slate-500">{copy("Page", "पृष्ठ")} {page} {copy("of", "में से")} {pageCount}</span><Button variant="secondary" disabled={page >= pageCount || movementQuery.isPending} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>{copy("Next", "अगला")}</Button></div></section>}
    </>}
  </div>;
}
