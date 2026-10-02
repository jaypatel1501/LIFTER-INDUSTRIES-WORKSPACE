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
import { financialYearSchema } from "@/lib/validation/companies";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    financialYears: z.array(z.object({
      id: z.string(), name: z.string(), startDate: z.string(), endDate: z.string(),
      booksBeginningDate: z.string(), status: z.enum(["OPEN", "CLOSED"]),
    })),
    total: z.number(),
  }),
});
type Values = z.input<typeof financialYearSchema>;

export function FinancialYearsManager({ locale, canManage, canClose }: {
  locale: Locale;
  canManage: boolean;
  canClose: boolean;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["company-financial-years", status, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (status) params.set("status", status);
      const response = await fetch(`/api/companies/financial-years?${params}`);
      if (!response.ok) throw new Error("Could not load financial years.");
      return responseSchema.parse(await response.json()).data;
    },
  });
  const form = useForm<Values>({
    resolver: zodResolver(financialYearSchema),
    defaultValues: { name: "", startDate: "", endDate: "", booksBeginningDate: "" },
  });
  const createMutation = useMutation({
    mutationFn: async (values: Values) => {
      const response = await fetch("/api/companies/financial-years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not create financial year.");
    },
    onSuccess: async () => {
      form.reset();
      setMessage(managementCopy(locale, "Financial year created.", "वित्तीय वर्ष बनाया गया।"));
      await queryClient.invalidateQueries({ queryKey: ["company-financial-years"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const closeMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/companies/financial-years/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CLOSED" }),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not close financial year.");
    },
    onSuccess: async () => {
      setMessage(managementCopy(locale, "Financial year closed.", "वित्तीय वर्ष बंद किया गया।"));
      await queryClient.invalidateQueries({ queryKey: ["company-financial-years"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const dateLabel = (date: string) => new Intl.DateTimeFormat(locale === "HI" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(date));
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));

  return (
    <div className="space-y-6">
      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">{copy("Create financial year", "वित्तीय वर्ष बनाएँ")}</h2>
          <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
            <label className="grid gap-1 text-sm">{copy("Name", "नाम")}<Input placeholder="FY 2026–27" {...form.register("name")} /></label>
            <label className="grid gap-1 text-sm">{copy("Start date", "प्रारंभ तिथि")}<Input type="date" {...form.register("startDate")} /></label>
            <label className="grid gap-1 text-sm">{copy("End date", "समाप्ति तिथि")}<Input type="date" {...form.register("endDate")} /></label>
            <label className="grid gap-1 text-sm">{copy("Books beginning date", "लेखा प्रारंभ तिथि")}<Input type="date" {...form.register("booksBeginningDate")} /></label>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={createMutation.isPending}>{copy("Create financial year", "वित्तीय वर्ष बनाएँ")}</Button>
            </div>
            {Object.values(form.formState.errors).map((error, index) => error?.message && <p key={index} className="text-sm text-red-700">{error.message}</p>)}
          </form>
        </section>
      )}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{copy("Financial years and books dates", "वित्तीय वर्ष और लेखा तिथियाँ")}</h2>
            <p className="mt-1 text-sm text-slate-600">{copy("Dates are company-scoped; overlapping periods are rejected.", "तिथियाँ कंपनी के अनुसार हैं; आपस में ओवरलैप अवधि अस्वीकार होती है।")}</p>
          </div>
          <label className="grid gap-1 text-sm">{copy("Status", "स्थिति")}
            <select className="h-10 rounded-lg border border-slate-300 bg-white px-3" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">{copy("All", "सभी")}</option><option value="OPEN">{copy("Open", "खुला")}</option><option value="CLOSED">{copy("Closed", "बंद")}</option>
            </select>
          </label>
        </div>
        {query.isPending && <p role="status" className="py-8">{copy("Loading financial years…", "वित्तीय वर्ष लोड हो रहे हैं…")}</p>}
        {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
        {query.data?.financialYears.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No financial years found.", "कोई वित्तीय वर्ष नहीं मिला।")}</p>}
        {query.data?.financialYears.map((year) => (
          <article key={year.id} className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-100 p-4">
            <div>
              <h3 className="font-semibold">{year.name}</h3>
              <p className="text-sm text-slate-600">{dateLabel(year.startDate)} – {dateLabel(year.endDate)}</p>
              <p className="text-xs text-slate-500">{copy("Books begin", "लेखा प्रारंभ")}: {dateLabel(year.booksBeginningDate)} · {copy(year.status, year.status === "OPEN" ? "खुला" : "बंद")}</p>
            </div>
            {year.status === "OPEN" && canClose && (
              <Button variant="secondary" size="sm" disabled={closeMutation.isPending} onClick={() => closeMutation.mutate(year.id)}>{copy("Close year", "वर्ष बंद करें")}</Button>
            )}
          </article>
        ))}
        {query.data && query.data.total > 25 && (
          <div className="mt-4 flex items-center justify-between">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button>
            <span className="text-sm text-slate-600">{copy("Page", "पृष्ठ")} {page} / {pageCount}</span>
            <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button>
          </div>
        )}
      </section>
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}
