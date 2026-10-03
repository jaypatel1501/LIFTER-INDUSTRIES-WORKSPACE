"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function CreateCompanyPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12"><div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-slate-600">Loading…</div></main>}>
      <CreateCompanyContent />
    </Suspense>
  );
}

function CreateCompanyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const password = typeof window !== "undefined" ? sessionStorage.getItem("erp-registration-password") ?? "" : "";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    companyName: "",
    legalName: "",
    country: "India",
    currency: "INR",
    timezone: "Asia/Kolkata",
    financialYearStartMonth: "4",
    booksBeginningDate: "",
  });

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/register/create-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          companyName: form.companyName,
          legalName: form.legalName,
          country: form.country,
          currency: form.currency,
          timezone: form.timezone,
          financialYearStartMonth: Number(form.financialYearStartMonth),
          booksBeginningDate: form.booksBeginningDate,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Company setup failed.");
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        router.push("/login");
      } else {
        router.push("/dashboard");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Company setup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Create company</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">Set up your ERP workspace</h1>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm text-slate-700 md:col-span-2"><span>Legal company name</span><input value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" /></label>
          <label className="grid gap-1 text-sm text-slate-700 md:col-span-2"><span>Display name</span><input value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" /></label>
          <label className="grid gap-1 text-sm text-slate-700"><span>Country</span><input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" /></label>
          <label className="grid gap-1 text-sm text-slate-700"><span>Currency</span><input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" /></label>
          <label className="grid gap-1 text-sm text-slate-700"><span>Timezone</span><input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" /></label>
          <label className="grid gap-1 text-sm text-slate-700"><span>Financial year start month</span><input type="number" min={1} max={12} value={form.financialYearStartMonth} onChange={(event) => setForm({ ...form, financialYearStartMonth: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" /></label>
          <label className="grid gap-1 text-sm text-slate-700 md:col-span-2"><span>Books beginning date</span><input type="date" value={form.booksBeginningDate} onChange={(event) => setForm({ ...form, booksBeginningDate: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" /></label>
        </div>
        {message && <p className="mt-4 text-sm text-red-700" role="alert">{message}</p>}
        <button type="button" className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-3 font-medium text-white disabled:opacity-60" disabled={busy} onClick={() => void submit()}>{busy ? "Creating company…" : "Create company"}</button>
      </div>
    </main>
  );
}
