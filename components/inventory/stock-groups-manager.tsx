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
import { stockGroupCreateSchema } from "@/lib/validation/inventory";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({ groups: z.array(z.object({
    id: z.string(), parentId: z.string().nullable(), name: z.string(), code: z.string(),
    description: z.string().nullable(), isSystem: z.boolean(),
    parent: z.object({ id: z.string(), name: z.string() }).nullable(),
    _count: z.object({ items: z.number(), children: z.number() }),
  })) }),
});
const formSchema = stockGroupCreateSchema.extend({
  parentId: z.string().min(1).max(64).nullable().optional().or(z.literal("")),
});
type FormValues = z.input<typeof formSchema>;

export function StockGroupsManager({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const query = useQuery({
    queryKey: ["inventory-stock-groups"],
    queryFn: async () => {
      const response = await fetch("/api/inventory/groups");
      if (!response.ok) throw new Error("Could not load stock groups.");
      return responseSchema.parse(await response.json()).data.groups;
    },
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", code: "", parentId: null, description: "" },
  });
  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await fetch(editingId ? `/api/inventory/groups/${editingId}` : "/api/inventory/groups", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId
          ? { name: values.name, parentId: values.parentId || null, description: values.description }
          : { ...values, parentId: values.parentId || null }),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save stock group.");
    },
    onSuccess: async () => {
      setEditingId("");
      form.reset();
      setMessage(copy("Stock group saved.", "स्टॉक समूह सहेजा गया।"));
      await client.invalidateQueries({ queryKey: ["inventory-stock-groups"] });
      await client.invalidateQueries({ queryKey: ["inventory-items"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/inventory/groups/${id}`, { method: "DELETE" });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not delete stock group.");
    },
    onSuccess: async () => {
      setMessage(copy("Stock group deleted.", "स्टॉक समूह हटाया गया।"));
      await client.invalidateQueries({ queryKey: ["inventory-stock-groups"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const groups = (query.data ?? []).filter((group) =>
    !search || `${group.name} ${group.code}`.toLowerCase().includes(search.toLowerCase()),
  );
  const edit = (group: NonNullable<typeof query.data>[number]) => {
    setEditingId(group.id);
    form.reset({ name: group.name, code: group.code, parentId: group.parentId, description: group.description ?? "" });
  };

  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">{copy("Stock groups", "स्टॉक समूह")}</h1><p className="mt-2 text-sm text-slate-600">{copy("Organize stock items in a company-scoped parent-child hierarchy.", "स्टॉक आइटम को कंपनी-आधारित अभिभावक-चाइल्ड समूहों में व्यवस्थित करें।")}</p></header>
    {canManage && <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">{copy(editingId ? "Edit group" : "Create stock group", editingId ? "समूह संपादित करें" : "स्टॉक समूह बनाएँ")}</h2>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <label className="grid gap-1 text-sm">{copy("Name", "नाम")}<Input {...form.register("name")} /></label>
        {!editingId && <label className="grid gap-1 text-sm">{copy("Code", "कोड")}<Input {...form.register("code")} /></label>}
        <label className="grid gap-1 text-sm">{copy("Parent group", "अभिभावक समूह")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...form.register("parentId")}><option value="">{copy("Top-level", "शीर्ष स्तर")}</option>{query.data?.filter((group) => group.id !== editingId).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">{copy("Description", "विवरण")}<Input {...form.register("description")} /></label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4"><Button disabled={save.isPending}>{copy(save.isPending ? "Saving…" : "Save group", save.isPending ? "सहेजा जा रहा है…" : "समूह सहेजें")}</Button>{editingId && <Button type="button" variant="secondary" onClick={() => { setEditingId(""); form.reset(); }}>{copy("Cancel", "रद्द करें")}</Button>}{message && <p role="status" className="text-sm text-slate-600">{message}</p>}</div>
      </form>
    </section>}
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <label className="grid max-w-lg gap-1 text-sm">{copy("Search groups", "समूह खोजें")}<Input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {query.isPending && <p role="status" className="py-8">{copy("Loading groups…", "समूह लोड हो रहे हैं…")}</p>}
      {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
      {groups.length === 0 && query.data && <p className="py-8 text-sm text-slate-500">{copy("No groups found.", "कोई समूह नहीं मिला।")}</p>}
      <div className="mt-4 space-y-2">{groups.map((group) => <article key={group.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 p-4">
        <div><h3 className="font-medium">{group.name}{group.isSystem && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{copy("Standard", "मानक")}</span>}</h3><p className="text-xs text-slate-500">{group.code} · {group.parent?.name ?? copy("Top-level", "शीर्ष स्तर")} · {group._count.items} {copy("items", "आइटम")} · {group._count.children} {copy("subgroups", "उपसमूह")}</p>{group.description && <p className="mt-1 text-sm text-slate-600">{group.description}</p>}</div>
        {canManage && !group.isSystem && <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => edit(group)}>{copy("Edit", "संपादित करें")}</Button><Button size="sm" variant="secondary" disabled={remove.isPending || group._count.items > 0 || group._count.children > 0} onClick={() => remove.mutate(group.id)}>{copy("Delete", "हटाएँ")}</Button></div>}
      </article>)}</div>
      {remove.isError && <p role="alert" className="mt-3 text-sm text-red-700">{remove.error.message}</p>}
    </section>
  </div>;
}
