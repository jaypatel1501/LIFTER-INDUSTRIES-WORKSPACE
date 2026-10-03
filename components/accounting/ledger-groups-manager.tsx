"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { ledgerGroupCreateSchema } from "@/lib/validation/accounting";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    groups: z.array(z.object({
      id: z.string(), parentId: z.string().nullable(), name: z.string(), code: z.string(),
      nature: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
      isSystem: z.boolean(), _count: z.object({ ledgers: z.number(), children: z.number() }),
      parent: z.object({ id: z.string(), name: z.string() }).nullable(),
    })),
  }),
});
type FormValues = z.input<typeof ledgerGroupCreateSchema>;

export function LedgerGroupsManager({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState("");
  const [search, setSearch] = useState("");
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const query = useQuery({
    queryKey: ["accounting-ledger-groups"],
    queryFn: async () => {
      const response = await fetch("/api/accounting/groups");
      if (!response.ok) throw new Error("Could not load ledger groups.");
      return responseSchema.parse(await response.json()).data.groups;
    },
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(ledgerGroupCreateSchema),
    defaultValues: { name: "", code: "", nature: "ASSET", parentId: null },
  });
  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const url = editingId ? `/api/accounting/groups/${editingId}` : "/api/accounting/groups";
      const response = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { name: values.name, parentId: values.parentId } : values),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save ledger group.");
    },
    onSuccess: async () => {
      form.reset();
      setEditingId("");
      setMessage(copy("Ledger group saved.", "खाता समूह सहेजा गया।"));
      await queryClient.invalidateQueries({ queryKey: ["accounting-ledger-groups"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/accounting/groups/${id}`, { method: "DELETE" });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not delete ledger group.");
    },
    onSuccess: async () => {
      setMessage(copy("Ledger group deleted.", "खाता समूह हटाया गया।"));
      await queryClient.invalidateQueries({ queryKey: ["accounting-ledger-groups"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const nature = useWatch({ control: form.control, name: "nature" });
  const groups = (query.data ?? []).filter((group) =>
    !search || `${group.name} ${group.code} ${group.nature}`.toLowerCase().includes(search.toLowerCase()),
  );
  const startEdit = (group: NonNullable<typeof query.data>[number]) => {
    setEditingId(group.id);
    form.reset({ name: group.name, code: group.code, nature: group.nature, parentId: group.parentId });
  };

  return (
    <div className="space-y-6">
      <header><h1 className="text-2xl font-semibold">{copy("Ledger groups", "खाता समूह")}</h1><p className="mt-2 text-sm text-slate-600">{copy("A standard parent-child chart is created for each company. Custom groups follow the parent account nature.", "हर कंपनी के लिए मानक अभिभावक-चाइल्ड खाता संरचना बनती है। कस्टम समूह अभिभावक खाते की प्रकृति का पालन करते हैं।")}</p></header>
      {canManage && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy(editingId ? "Edit custom group" : "Add custom group", editingId ? "कस्टम समूह संपादित करें" : "कस्टम समूह जोड़ें")}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}>
          <label className="grid gap-1 text-sm">{copy("Name", "नाम")}<Input {...form.register("name")} /></label>
          {!editingId && <label className="grid gap-1 text-sm">{copy("Code", "कोड")}<Input {...form.register("code")} /></label>}
          {!editingId && <label className="grid gap-1 text-sm">{copy("Account nature", "खाते की प्रकृति")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" {...form.register("nature")}>
              {(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const).map((item) => <option key={item} value={item}>{copy(item, ({ ASSET: "संपत्ति", LIABILITY: "देयता", EQUITY: "इक्विटी", INCOME: "आय", EXPENSE: "व्यय" })[item])}</option>)}
            </select>
          </label>}
          <label className="grid gap-1 text-sm">{copy("Parent group", "अभिभावक समूह")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" {...form.register("parentId")}>
              <option value="">{copy("Top-level", "शीर्ष स्तर")}</option>
              {query.data?.filter((group) => group.nature === nature && group.id !== editingId).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={saveMutation.isPending}>{copy(saveMutation.isPending ? "Saving…" : "Save group", saveMutation.isPending ? "सहेजा जा रहा है…" : "समूह सहेजें")}</Button>
            {editingId && <Button type="button" variant="secondary" onClick={() => { setEditingId(""); form.reset(); }}>{copy("Cancel", "रद्द करें")}</Button>}
            {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
          </div>
          {Object.values(form.formState.errors).map((error, index) => error?.message && <p key={index} role="alert" className="text-sm text-red-700">{error.message}</p>)}
        </form>
      </section>}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <label className="grid max-w-lg gap-1 text-sm">{copy("Search groups", "समूह खोजें")}<Input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {query.isPending && <p role="status" className="py-8">{copy("Loading groups…", "समूह लोड हो रहे हैं…")}</p>}
        {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
        {groups.length === 0 && query.data && <p className="py-8 text-sm text-slate-500">{copy("No groups match your search.", "आपकी खोज से कोई समूह नहीं मिला।")}</p>}
        <div className="mt-4 space-y-2">
          {groups.map((group) => <article key={group.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
            <div className="min-w-56">
              <h3 className="font-medium">{group.name}{group.isSystem && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{copy("Standard", "मानक")}</span>}</h3>
              <p className="text-xs text-slate-500">{group.code} · {copy(group.nature, ({ ASSET: "संपत्ति", LIABILITY: "देयता", EQUITY: "इक्विटी", INCOME: "आय", EXPENSE: "व्यय" })[group.nature])} · {group.parent?.name ?? copy("Top-level", "शीर्ष स्तर")} · {group._count.ledgers} {copy("ledgers", "खाते")} · {group._count.children} {copy("subgroups", "उपसमूह")}</p>
            </div>
            {canManage && !group.isSystem && <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => startEdit(group)}>{copy("Edit", "संपादित करें")}</Button>
              <Button type="button" size="sm" variant="secondary" disabled={deleteMutation.isPending || group._count.children > 0 || group._count.ledgers > 0} onClick={() => deleteMutation.mutate(group.id)}>{copy("Delete", "हटाएँ")}</Button>
            </div>}
          </article>)}
        </div>
        {deleteMutation.isError && <p role="alert" className="mt-3 text-sm text-red-700">{deleteMutation.error.message}</p>}
      </section>
    </div>
  );
}
