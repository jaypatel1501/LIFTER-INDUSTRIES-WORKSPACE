"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    costCentres: z.array(z.object({ id: z.string(), name: z.string(), code: z.string(), isActive: z.boolean() })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});

export function CostCentresManager({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const query = useQuery({
    queryKey: ["cost-centres", search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (search) params.set("search", search);
      const response = await fetch(`/api/accounting/cost-centres?${params}`);
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? copy("Could not load cost centres.", "लागत केंद्र लोड नहीं हो सके।"));
      return responseSchema.parse(body).data;
    },
  });
  const save = useMutation({
    mutationFn: async (input: { id?: string; isActive?: boolean }) => {
      const response = input.id
        ? await fetch(`/api/accounting/cost-centres/${input.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: input.isActive }) })
        : await fetch("/api/accounting/cost-centres", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, code }) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? copy("Could not save the cost centre.", "लागत केंद्र सहेजा नहीं जा सका।"));
      return body;
    },
    onSuccess: async () => {
      setName("");
      setCode("");
      await client.invalidateQueries({ queryKey: ["cost-centres"] });
      await client.invalidateQueries({ queryKey: ["voucher-options"] });
    },
  });
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">{copy("Cost centres", "लागत केंद्र")}</h1><p className="mt-2 text-sm text-slate-600">{copy("Company-scoped cost allocation dimensions used by voucher lines. Historical allocations remain unchanged when a centre is deactivated.", "वाउचर पंक्तियों में उपयोग होने वाले कंपनी-स्तरीय लागत आवंटन। केंद्र निष्क्रिय होने पर ऐतिहासिक आवंटन यथावत रहते हैं।")}</p></header>
    {canManage && <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-[1fr_220px_auto]" onSubmit={(event) => { event.preventDefault(); save.mutate({}); }}>
      <label className="grid gap-1 text-sm">{copy("Name", "नाम")}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
      <label className="grid gap-1 text-sm">{copy("Code", "कोड")}<Input value={code} onChange={(event) => setCode(event.target.value)} maxLength={32} pattern="[A-Za-z0-9_-]+" required /></label>
      <Button className="self-end" disabled={save.isPending}>{copy("Add cost centre", "लागत केंद्र जोड़ें")}</Button>
      {save.isError && <p role="alert" className="text-sm text-red-700 sm:col-span-full">{save.error.message}</p>}
    </form>}
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <label className="grid max-w-xl gap-1 text-sm">{copy("Search", "खोजें")}<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
      {query.isPending && <p role="status" className="py-8">{copy("Loading cost centres…", "लागत केंद्र लोड हो रहे हैं…")}</p>}
      {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
      {query.data?.costCentres.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No cost centres found.", "कोई लागत केंद्र नहीं मिला।")}</p>}
      {!!query.data?.costCentres.length && <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-sm"><thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Name", "नाम")}</th><th>{copy("Code", "कोड")}</th><th>{copy("Status", "स्थिति")}</th>{canManage && <th>{copy("Action", "कार्रवाई")}</th>}</tr></thead><tbody className="divide-y">{query.data.costCentres.map((centre) => <tr key={centre.id}><td className="py-3 font-medium">{centre.name}</td><td>{centre.code}</td><td>{centre.isActive ? copy("Active", "सक्रिय") : copy("Inactive", "निष्क्रिय")}</td>{canManage && <td><Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate({ id: centre.id, isActive: !centre.isActive })}>{centre.isActive ? copy("Deactivate", "निष्क्रिय करें") : copy("Activate", "सक्रिय करें")}</Button></td>}</tr>)}</tbody></table></div>}
      <div className="flex items-center justify-between border-t pt-3 text-sm"><span>{copy("Records", "रिकॉर्ड")}: {query.data?.total ?? 0}</span><div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{copy("Previous", "पिछला")}</Button><span>{page} / {pageCount}</span><Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>{copy("Next", "अगला")}</Button></div></div>
    </section>
  </div>;
}
