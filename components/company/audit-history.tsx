"use client";

import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    entries: z.array(z.object({
      id: z.string(), action: z.string(), entityType: z.string(), entityId: z.string().nullable(),
      changes: z.unknown(), reason: z.string().nullable(), ipAddress: z.string().nullable(),
      createdAt: z.string(), actor: z.object({ name: z.string().nullable(), email: z.string() }).nullable(),
    })),
    total: z.number(),
  }),
});

export function AuditHistory({ locale }: { locale: Locale }) {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const query = useQuery({
    queryKey: ["company-audit", search, action, entityType, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (search) params.set("search", search);
      if (action) params.set("action", action);
      if (entityType) params.set("entityType", entityType);
      const response = await fetch(`/api/audit?${params}`);
      if (!response.ok) throw new Error("Could not load audit trail.");
      return responseSchema.parse(await response.json()).data;
    },
  });
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  const dateLabel = (date: string) => new Intl.DateTimeFormat(locale === "HI" ? "hi-IN" : "en-IN", {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(date));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{copy("Company audit trail", "कंपनी ऑडिट ट्रेल")}</h2>
          <p className="mt-1 text-sm text-slate-600">{copy("Audited company, access, financial-year, and security changes.", "कंपनी, पहुँच, वित्तीय वर्ष और सुरक्षा बदलावों का ऑडिट।")}</p>
        </div>
        <p className="text-sm text-slate-500">{query.data?.total ?? 0} {copy("events", "घटनाएँ")}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm">{copy("Search action, user or record", "कार्रवाई, उपयोगकर्ता या रिकॉर्ड खोजें")}
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </label>
        <label className="grid gap-1 text-sm">{copy("Filter action", "कार्रवाई फ़िल्टर करें")}
          <Input placeholder="COMPANY_" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} />
        </label>
        <label className="grid gap-1 text-sm">{copy("Entity type", "इकाई प्रकार")}
          <Input placeholder="Company" value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); }} />
        </label>
      </div>
      {query.isPending && <p role="status" className="py-8 text-sm text-slate-500">{copy("Loading audit events…", "ऑडिट घटनाएँ लोड हो रही हैं…")}</p>}
      {query.isError && <p role="alert" className="py-8 text-sm text-red-700">{query.error.message}</p>}
      {query.data?.entries.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No audit events found.", "कोई ऑडिट घटना नहीं मिली।")}</p>}
      <div className="mt-4 divide-y divide-slate-100">
        {query.data?.entries.map((entry) => (
          <article key={entry.id} className="py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-slate-900">{entry.action.replaceAll("_", " ")}</h3>
              <time className="text-xs text-slate-500">{dateLabel(entry.createdAt)}</time>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {entry.entityType}{entry.entityId ? ` · ${entry.entityId}` : ""}
              {" · "}{entry.actor?.name || entry.actor?.email || copy("System", "सिस्टम")}
              {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
            </p>
            {entry.reason && <p className="mt-1 text-sm text-slate-600">{entry.reason}</p>}
            {entry.changes !== null && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-blue-700">{copy("View change details", "बदलाव विवरण देखें")}</summary>
                <pre className="mt-2 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(entry.changes, null, 2)}</pre>
              </details>
            )}
          </article>
        ))}
      </div>
      {query.data && query.data.total > 25 && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button>
          <span className="text-sm text-slate-600">{copy("Page", "पृष्ठ")} {page} / {pageCount}</span>
          <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button>
        </div>
      )}
    </section>
  );
}
