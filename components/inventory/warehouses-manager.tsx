"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { warehouseCreateSchema } from "@/lib/validation/inventory";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({ warehouses: z.array(z.object({
    id: z.string(), name: z.string(), code: z.string(), address: z.string().nullable(),
    parentId: z.string().nullable(), isActive: z.boolean(), isSystem: z.boolean(),
    parent: z.object({ id: z.string(), name: z.string() }).nullable(),
    _count: z.object({ children: z.number(), balances: z.number() }),
  })) }),
});
const formSchema = warehouseCreateSchema.extend({
  parentId: z.string().min(1).max(64).nullable().optional().or(z.literal("")),
});
type FormValues = z.input<typeof formSchema>;

export function WarehousesManager({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["inventory-warehouses"],
    queryFn: async () => {
      const response = await fetch("/api/inventory/warehouses");
      if (!response.ok) throw new Error("Could not load godowns.");
      return responseSchema.parse(await response.json()).data.warehouses;
    },
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", code: "", parentId: null, address: "" },
  });
  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await fetch(editingId ? `/api/inventory/warehouses/${editingId}` : "/api/inventory/warehouses", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId
          ? { name: values.name, parentId: values.parentId || null, address: values.address }
          : { ...values, parentId: values.parentId || null }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save godown.");
    },
    onSuccess: async () => {
      setEditingId("");
      form.reset();
      setMessage(copy("Godown saved.", "गोदाम सहेजा गया।"));
      await client.invalidateQueries({ queryKey: ["inventory-warehouses"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const response = await fetch(`/api/inventory/warehouses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update godown.");
    },
    onSuccess: async () => { setMessage(copy("Godown status updated.", "गोदाम स्थिति अपडेट की गई।")); await client.invalidateQueries({ queryKey: ["inventory-warehouses"] }); },
    onError: (error) => setMessage(error.message),
  });
  const warehouses = (query.data ?? []).filter((warehouse) =>
    !search || `${warehouse.name} ${warehouse.code} ${warehouse.address ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  const edit = (warehouse: NonNullable<typeof query.data>[number]) => {
    setEditingId(warehouse.id);
    form.reset({ name: warehouse.name, code: warehouse.code, parentId: warehouse.parentId, address: warehouse.address ?? "" });
  };
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">{copy("Godowns and locations", "गोदाम और स्थान")}</h1><p className="mt-2 text-sm text-slate-600">{copy("Manage your company’s warehouse hierarchy. Stock balances and movements always remain company-scoped.", "कंपनी की गोदाम संरचना प्रबंधित करें। स्टॉक शेष और गतिविधियाँ कंपनी तक सीमित रहती हैं।")}</p></header>
    {canManage && <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{copy(editingId ? "Edit godown or sub-location" : "Add godown or sub-location", editingId ? "गोदाम या उप-स्थान संपादित करें" : "गोदाम या उप-स्थान जोड़ें")}</h2><form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <label className="grid gap-1 text-sm">{copy("Name", "नाम")}<Input {...form.register("name")} /></label>
      {!editingId && <label className="grid gap-1 text-sm">{copy("Code", "कोड")}<Input {...form.register("code")} /></label>}
      <label className="grid gap-1 text-sm">{copy("Parent godown", "अभिभावक गोदाम")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...form.register("parentId")}><option value="">{copy("Top-level", "शीर्ष स्तर")}</option>{query.data?.filter((warehouse) => warehouse.isActive && warehouse.id !== editingId).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">{copy("Address", "पता")}<Input {...form.register("address")} /></label>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4"><Button disabled={save.isPending}>{copy(editingId ? "Save changes" : "Create godown", editingId ? "परिवर्तन सहेजें" : "गोदाम बनाएँ")}</Button>{editingId && <Button type="button" variant="secondary" onClick={() => { setEditingId(""); form.reset(); }}>{copy("Cancel", "रद्द करें")}</Button>}{message && <p role="status" className="text-sm text-slate-600">{message}</p>}</div>
    </form>{save.isError && <p role="alert" className="mt-3 text-sm text-red-700">{save.error.message}</p>}</section>}
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <label className="grid max-w-lg gap-1 text-sm">{copy("Search godowns", "गोदाम खोजें")}<Input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {query.isPending && <p role="status" className="py-8">{copy("Loading godowns…", "गोदाम लोड हो रहे हैं…")}</p>}
      {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
      {query.data && warehouses.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No godowns match this search.", "इस खोज से कोई गोदाम मेल नहीं खाता।")}</p>}
      <div className="mt-4 space-y-2">{warehouses.map((warehouse) => <article key={warehouse.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 p-4">
        <div><h3 className="font-medium">{warehouse.name}{warehouse.isSystem && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{copy("Main", "मुख्य")}</span>}</h3><p className="text-xs text-slate-500">{warehouse.code} · {warehouse.parent?.name ?? copy("Top-level", "शीर्ष स्तर")} · {warehouse._count.children} {copy("locations", "स्थान")} · {warehouse._count.balances} {copy("balances", "शेष")}</p>{warehouse.address && <p className="mt-1 text-sm text-slate-600">{warehouse.address}</p>}</div>
        <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${warehouse.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{warehouse.isActive ? copy("Active", "सक्रिय") : copy("Inactive", "निष्क्रिय")}</span>{canManage && !warehouse.isSystem && <><Button size="sm" variant="secondary" onClick={() => edit(warehouse)}>{copy("Edit", "संपादित करें")}</Button><Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => update.mutate({ id: warehouse.id, isActive: !warehouse.isActive })}>{copy(warehouse.isActive ? "Deactivate" : "Activate", warehouse.isActive ? "निष्क्रिय करें" : "सक्रिय करें")}</Button></>}</div>
      </article>)}</div>
      {update.isError && <p role="alert" className="mt-3 text-sm text-red-700">{update.error.message}</p>}
    </section>
  </div>;
}
