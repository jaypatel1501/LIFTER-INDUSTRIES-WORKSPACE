"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { stockItemCreateSchema } from "@/lib/validation/inventory";

const listSchema = z.object({
  success: z.literal(true),
  data: z.object({
    items: z.array(z.object({
      id: z.string(), name: z.string(), code: z.string().nullable(), hsnSac: z.string().nullable(),
      gstRate: z.string(), purchaseRate: z.string(), salesRate: z.string(), mrp: z.string().nullable(),
      reorderLevel: z.string(), minimumLevel: z.string(), maximumLevel: z.string().nullable(),
      batchTracked: z.boolean(), barcode: z.string().nullable(), isActive: z.boolean(),
      onHand: z.string(), stockValue: z.string(),
      group: z.object({ id: z.string(), name: z.string(), code: z.string() }),
      baseUnit: z.object({ id: z.string(), name: z.string(), symbol: z.string(), precision: z.number() }),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});
type FormValues = z.input<typeof stockItemCreateSchema>;

export function StockItemsManager({ locale, canCreate, booksBeginningDate, companyCurrency, options: optionData }: {
  locale: Locale; canCreate: boolean; booksBeginningDate: string; companyCurrency: string;
  options: { groups: { id: string; name: string; code: string }[]; units: { id: string; name: string; symbol: string; precision: number }[]; warehouses: { id: string; name: string; code: string; isActive: boolean }[] };
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const query = useQuery({
    queryKey: ["inventory-items", search, groupId, status, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search) params.set("search", search);
      if (groupId) params.set("groupId", groupId);
      if (status) params.set("status", status);
      const response = await fetch(`/api/inventory/items?${params}`);
      if (!response.ok) throw new Error("Could not load stock items.");
      return listSchema.parse(await response.json()).data;
    },
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(stockItemCreateSchema),
    defaultValues: {
      name: "", code: "", groupId: "", baseUnitId: "", hsnSac: "", gstRate: "0",
      purchaseRate: "0", salesRate: "0", mrp: "", reorderLevel: "0", minimumLevel: "0",
      maximumLevel: "", batchTracked: false, barcode: "", alternateUnits: [],
      openingStock: [], openingDate: booksBeginningDate || new Date().toISOString().slice(0, 10),
    },
  });
  const alternateUnits = useFieldArray({ control: form.control, name: "alternateUnits" });
  const openingStock = useFieldArray({ control: form.control, name: "openingStock" });
  const batchTracked = useWatch({ control: form.control, name: "batchTracked" });
  const baseUnitId = useWatch({ control: form.control, name: "baseUnitId" });
  const openingDate = useWatch({ control: form.control, name: "openingDate" });
  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await fetch("/api/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(values),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not create stock item.");
    },
    onSuccess: async () => {
      form.reset();
      setMessage(copy("Stock item created.", "स्टॉक आइटम बनाया गया।"));
      await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory-report"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const currency = (value: string) => new Intl.NumberFormat(locale === "HI" ? "hi-IN" : "en-IN", {
    style: "currency", currency: companyCurrency, maximumFractionDigits: 2,
  }).format(Number(value));
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{copy("Stock items", "स्टॉक आइटम")}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy("Manage HSN/GST mapping, base and alternate units, rates, MRP, barcodes, reorder thresholds, godown balances and batch expiry details.", "एचएसएन/जीएसटी, मूल और वैकल्पिक इकाइयाँ, दरें, एमआरपी, बारकोड, पुनः-आदेश स्तर, गोदाम शेष और बैच समाप्ति विवरण प्रबंधित करें।")}</p>
      </header>
      {canCreate && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Create stock item", "स्टॉक आइटम बनाएँ")}</h2>
        {optionData.groups.length === 0 && <p role="alert" className="mt-3 text-sm text-amber-700">{copy("No stock groups are available; ask an administrator to configure the required inventory permissions or create a stock group.", "स्टॉक समूह उपलब्ध नहीं हैं; व्यवस्थापक से आवश्यक इन्वेंटरी अनुमतियाँ या स्टॉक समूह बनाने को कहें।")}</p>}
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
          <label className="grid gap-1 text-sm">{copy("Item name", "आइटम का नाम")}<Input {...form.register("name")} /></label>
          <label className="grid gap-1 text-sm">{copy("Item code", "आइटम कोड")}<Input {...form.register("code")} /></label>
          <label className="grid gap-1 text-sm">{copy("Stock group", "स्टॉक समूह")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...form.register("groupId")}><option value="">{copy("Select group", "समूह चुनें")}</option>{optionData.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm">{copy("Base unit", "मूल इकाई")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...form.register("baseUnitId")}><option value="">{copy("Select unit", "इकाई चुनें")}</option>{optionData.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></label>
          <label className="grid gap-1 text-sm">{copy("HSN/SAC", "एचएसएन/एसएसी")}<Input {...form.register("hsnSac")} /></label>
          <label className="grid gap-1 text-sm">{copy("GST rate (%)", "जीएसटी दर (%)")}<Input inputMode="decimal" {...form.register("gstRate")} /></label>
          <label className="grid gap-1 text-sm">{copy("Purchase rate", "खरीद दर")}<Input inputMode="decimal" {...form.register("purchaseRate")} /></label>
          <label className="grid gap-1 text-sm">{copy("Sales rate", "बिक्री दर")}<Input inputMode="decimal" {...form.register("salesRate")} /></label>
          <label className="grid gap-1 text-sm">{copy("MRP", "एमआरपी")}<Input inputMode="decimal" {...form.register("mrp")} /></label>
          <label className="grid gap-1 text-sm">{copy("Barcode", "बारकोड")}<Input inputMode="numeric" {...form.register("barcode")} /></label>
          <label className="grid gap-1 text-sm">{copy("Minimum stock", "न्यूनतम स्टॉक")}<Input inputMode="decimal" {...form.register("minimumLevel")} /></label>
          <label className="grid gap-1 text-sm">{copy("Reorder level", "पुनः-आदेश स्तर")}<Input inputMode="decimal" {...form.register("reorderLevel")} /></label>
          <label className="grid gap-1 text-sm">{copy("Maximum stock", "अधिकतम स्टॉक")}<Input inputMode="decimal" {...form.register("maximumLevel")} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("batchTracked")} />{copy("Track batches, manufacturing and expiry dates", "बैच, निर्माण और समाप्ति तिथि ट्रैक करें")}</label>

          <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:col-span-2 lg:col-span-3">
            <legend className="px-1 text-sm font-medium">{copy("Alternate unit conversions", "वैकल्पिक इकाई रूपांतरण")}</legend>
            {alternateUnits.fields.map((field, index) => <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="grid gap-1 text-sm">{copy("Alternate unit", "वैकल्पिक इकाई")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...form.register(`alternateUnits.${index}.unitId`)}><option value="">{copy("Select unit", "इकाई चुनें")}</option>{optionData.units.filter((unit) => unit.id !== baseUnitId).map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></label>
              <label className="grid gap-1 text-sm">{copy("Base quantity per alternate unit", "प्रति वैकल्पिक इकाई मूल मात्रा")}<Input inputMode="decimal" {...form.register(`alternateUnits.${index}.baseQuantity`)} /></label>
              <label className="grid gap-1 text-sm">{copy("Barcode (optional)", "बारकोड (वैकल्पिक)")}<Input {...form.register(`alternateUnits.${index}.barcode`)} /></label>
              <Button type="button" className="self-end" variant="secondary" size="sm" onClick={() => alternateUnits.remove(index)}>{copy("Remove", "हटाएँ")}</Button>
            </div>)}
            <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={() => alternateUnits.append({ unitId: "", baseQuantity: "1", barcode: "" })}>{copy("Add alternate unit", "वैकल्पिक इकाई जोड़ें")}</Button>
          </fieldset>

          <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:col-span-2 lg:col-span-3">
            <legend className="px-1 text-sm font-medium">{copy("Opening stock by godown", "गोदाम-वार प्रारंभिक स्टॉक")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">{copy("Books-beginning date", "लेखा प्रारंभ तिथि")}<Input type="date" value={openingDate ?? ""} onChange={(event) => form.setValue("openingDate", event.target.value)} /></label>
            </div>
            {openingStock.fields.map((field, index) => <div key={field.id} className="grid gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-sm">{copy("Godown", "गोदाम")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...form.register(`openingStock.${index}.warehouseId`)}><option value="">{copy("Select godown", "गोदाम चुनें")}</option>{optionData.warehouses.filter((warehouse) => warehouse.isActive).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
              <label className="grid gap-1 text-sm">{copy("Quantity in base unit", "मूल इकाई में मात्रा")}<Input inputMode="decimal" {...form.register(`openingStock.${index}.quantity`)} /></label>
              <label className="grid gap-1 text-sm">{copy("Unit cost", "इकाई लागत")}<Input inputMode="decimal" {...form.register(`openingStock.${index}.unitCost`)} /></label>
              {batchTracked && <label className="grid gap-1 text-sm">{copy("Batch number", "बैच नंबर")}<Input {...form.register(`openingStock.${index}.batchNumber`)} /></label>}
              {batchTracked && <label className="grid gap-1 text-sm">{copy("Manufacturing date", "निर्माण तिथि")}<Input type="date" {...form.register(`openingStock.${index}.manufacturingDate`)} /></label>}
              {batchTracked && <label className="grid gap-1 text-sm">{copy("Expiry date", "समाप्ति तिथि")}<Input type="date" {...form.register(`openingStock.${index}.expiryDate`)} /></label>}
              <Button type="button" className="self-end" variant="secondary" size="sm" onClick={() => openingStock.remove(index)}>{copy("Remove location", "स्थान हटाएँ")}</Button>
            </div>)}
            <Button type="button" variant="secondary" size="sm" className="w-fit" disabled={!optionData.warehouses.some(({ isActive }) => isActive)} onClick={() => openingStock.append({
              warehouseId: optionData.warehouses.find(({ isActive }) => isActive)?.id ?? "",
              quantity: "1", unitCost: "0", batchNumber: "", manufacturingDate: "", expiryDate: "",
            })}>{copy("Add opening stock location", "प्रारंभिक स्टॉक स्थान जोड़ें")}</Button>
          </fieldset>
          {Object.entries(form.formState.errors).map(([key, error]) => error && <p key={key} role="alert" className="text-sm text-red-700 sm:col-span-2 lg:col-span-3">{error.message ?? copy("Review the entered values.", "दर्ज किए गए मान जाँचें।")}</p>)}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={createMutation.isPending || !optionData.groups.length || !optionData.units.length || !optionData.warehouses.some(({ isActive }) => isActive)}>{copy(createMutation.isPending ? "Saving…" : "Create stock item", createMutation.isPending ? "सहेजा जा रहा है…" : "स्टॉक आइटम बनाएँ")}</Button>
            {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
          </div>
        </form>
      </section>}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_220px_180px]">
          <label className="grid gap-1 text-sm">{copy("Search items", "आइटम खोजें")}<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={copy("Name, code, barcode or HSN", "नाम, कोड, बारकोड या एचएसएन")} /></label>
          <label className="grid gap-1 text-sm">{copy("Stock group", "स्टॉक समूह")}<select className="h-11 rounded-lg border border-slate-300 px-3" value={groupId} onChange={(event) => { setGroupId(event.target.value); setPage(1); }}><option value="">{copy("All groups", "सभी समूह")}</option>{optionData.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm">{copy("Status", "स्थिति")}<select className="h-11 rounded-lg border border-slate-300 px-3" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">{copy("All", "सभी")}</option><option value="ACTIVE">{copy("Active", "सक्रिय")}</option><option value="INACTIVE">{copy("Inactive", "निष्क्रिय")}</option></select></label>
        </div>
        {query.isPending && <p role="status" className="py-8">{copy("Loading stock items…", "स्टॉक आइटम लोड हो रहे हैं…")}</p>}
        {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
        {query.data?.items.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No stock items found.", "कोई स्टॉक आइटम नहीं मिला।")}</p>}
        {query.data && query.data.items.length > 0 && <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Item", "आइटम")}</th><th>{copy("Group", "समूह")}</th><th>{copy("HSN / GST", "एचएसएन / जीएसटी")}</th><th>{copy("Purchase / sales", "खरीद / बिक्री")}</th><th>{copy("MRP", "एमआरपी")}</th><th>{copy("On hand", "उपलब्ध स्टॉक")}</th><th>{copy("Stock value", "स्टॉक मूल्य")}</th></tr></thead>
            <tbody className="divide-y">{query.data.items.map((item) => <tr key={item.id}>
              <td className="py-3 font-medium"><Link className="text-blue-700 hover:underline" href={`/dashboard/inventory/${item.id}`}>{item.name}</Link>{item.code && <span className="block text-xs text-slate-500">{item.code}</span>}{item.barcode && <span className="text-xs text-slate-500">{item.barcode}</span>}</td>
              <td>{item.group.name}</td><td>{item.hsnSac ?? "—"}<span className="block text-xs text-slate-500">{item.gstRate}%</span></td>
              <td>{currency(item.purchaseRate)} / {currency(item.salesRate)}</td><td>{item.mrp ? currency(item.mrp) : "—"}</td>
              <td>{item.onHand} {item.baseUnit.symbol}{Number(item.onHand) <= Number(item.reorderLevel) && Number(item.reorderLevel) > 0 && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">{copy("Reorder", "पुनः-आदेश")}</span>}</td>
              <td>{currency(item.stockValue)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {query.data && query.data.total > 20 && <div className="mt-4 flex items-center justify-between"><span className="text-sm text-slate-500">{copy("Page", "पृष्ठ")} {page} / {pageCount}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{copy("Previous", "पिछला")}</Button><Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>{copy("Next", "अगला")}</Button></div></div>}
      </section>
    </div>
  );
}
