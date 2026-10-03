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
    entries: z.array(z.object({
      id: z.string(), createdAt: z.string(), ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
      user: z.object({ id: z.string(), name: z.string().nullable(), email: z.string() }),
    }).and(z.object({
      success: z.boolean().optional(),
      expiresAt: z.string().optional(),
      revokedAt: z.string().nullable().optional(),
    }))),
    total: z.number(),
    page: z.number(),
  }),
});

export function SecurityHistory({ locale, canRevoke }: { locale: Locale; canRevoke: boolean }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<"login" | "session">("login");
  const [search, setSearch] = useState("");
  const [success, setSuccess] = useState("");
  const [sessionStatus, setSessionStatus] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const query = useQuery({
    queryKey: ["company-security-history", type, search, success, sessionStatus, page],
    queryFn: async () => {
      const params = new URLSearchParams({ type, page: String(page), pageSize: "25" });
      if (search) params.set("search", search);
      if (type === "login" && success) params.set("success", success);
      if (type === "session" && sessionStatus) params.set("status", sessionStatus);
      const response = await fetch(`/api/companies/security/history?${params}`);
      if (!response.ok) throw new Error("Could not load security history.");
      return responseSchema.parse(await response.json()).data;
    },
  });
  const revokeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/companies/security/sessions/${sessionId}`, { method: "DELETE" });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not revoke session.");
    },
    onSuccess: async () => {
      setMessage(copy("Session revoked.", "सत्र रद्द किया गया।"));
      await queryClient.invalidateQueries({ queryKey: ["company-security-history"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const dateLabel = (date: string) => new Intl.DateTimeFormat(locale === "HI" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{copy("Sign-in and device session history", "साइन-इन और डिवाइस सत्र इतिहास")}</h2>
          <p className="mt-1 text-sm text-slate-600">{copy("History is limited to users with a membership in the active company.", "इतिहास सक्रिय कंपनी के सदस्यों तक सीमित है।")}</p>
        </div>
        <label className="grid gap-1 text-sm">{copy("Record type", "रिकॉर्ड प्रकार")}
          <select className="h-10 rounded-lg border border-slate-300 bg-white px-3" value={type} onChange={(event) => {
            if (event.target.value === "login" || event.target.value === "session") setType(event.target.value);
            setPage(1);
          }}>
            <option value="login">{copy("Login attempts", "लॉगिन प्रयास")}</option>
            <option value="session">{copy("Sessions", "सत्र")}</option>
          </select>
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">{copy("Search name or email", "नाम या ईमेल खोजें")}
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </label>
        {type === "login" ? (
          <label className="grid gap-1 text-sm">{copy("Login result", "लॉगिन परिणाम")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={success} onChange={(event) => { setSuccess(event.target.value); setPage(1); }}>
              <option value="">{copy("All attempts", "सभी प्रयास")}</option>
              <option value="true">{copy("Successful", "सफल")}</option>
              <option value="false">{copy("Failed", "विफल")}</option>
            </select>
          </label>
        ) : (
          <label className="grid gap-1 text-sm">{copy("Session status", "सत्र स्थिति")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={sessionStatus} onChange={(event) => { setSessionStatus(event.target.value); setPage(1); }}>
              <option value="">{copy("All sessions", "सभी सत्र")}</option>
              <option value="active">{copy("Active", "सक्रिय")}</option>
              <option value="revoked">{copy("Revoked", "रद्द")}</option>
              <option value="expired">{copy("Expired", "समाप्त")}</option>
            </select>
          </label>
        )}
      </div>
      {query.isPending && <p role="status" className="py-8 text-sm text-slate-500">{copy("Loading history…", "इतिहास लोड हो रहा है…")}</p>}
      {query.isError && <p role="alert" className="py-8 text-sm text-red-700">{query.error.message}</p>}
      {query.data?.entries.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No records found.", "कोई रिकॉर्ड नहीं मिला।")}</p>}
      <div className="mt-4 divide-y divide-slate-100">
        {query.data?.entries.map((entry) => {
          const loginResult = "success" in entry && entry.success !== undefined;
          const sessionRevoked = "revokedAt" in entry && entry.revokedAt !== undefined;
          const activeSession = sessionRevoked && !entry.revokedAt && entry.expiresAt && new Date(entry.expiresAt) > new Date();
          return (
            <article key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="min-w-0">
                <h3 className="truncate font-medium">{entry.user.name || entry.user.email}</h3>
                <p className="truncate text-sm text-slate-600">{entry.user.email} · {entry.ipAddress || copy("Unknown IP", "अज्ञात आईपी")}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {dateLabel(entry.createdAt)}
                  {loginResult ? ` · ${entry.success ? copy("Successful login", "सफल लॉगिन") : copy("Failed login", "विफल लॉगिन")}` : ""}
                  {sessionRevoked ? ` · ${activeSession ? copy("Active", "सक्रिय") : entry.revokedAt ? copy("Revoked", "रद्द") : copy("Expired", "समाप्त")}` : ""}
                </p>
                {entry.userAgent && <p className="mt-1 max-w-3xl truncate text-xs text-slate-500" title={entry.userAgent}>{entry.userAgent}</p>}
              </div>
              {type === "session" && canRevoke && activeSession && (
                <Button variant="destructive" size="sm" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(entry.id)}>{copy("Revoke session", "सत्र रद्द करें")}</Button>
              )}
            </article>
          );
        })}
      </div>
      {query.data && query.data.total > 25 && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button>
          <span className="text-sm text-slate-600">{copy("Page", "पृष्ठ")} {page} / {pageCount}</span>
          <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button>
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm text-slate-700">{message}</p>}
    </section>
  );
}
