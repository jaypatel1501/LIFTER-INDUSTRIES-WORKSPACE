"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function CompanyChoicePage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12"><div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-slate-600">Loading…</div></main>}>
      <CompanyChoiceContent />
    </Suspense>
  );
}

function CompanyChoiceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  async function choose(path: "CREATE_COMPANY" | "JOIN_COMPANY") {
    const response = await fetch("/api/auth/register/select-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, path }),
    });
    const body = await response.json();
    if (!response.ok) {
      window.alert(body?.error?.message ?? "Please complete registration verification first.");
      return;
    }
    if (path === "CREATE_COMPANY") {
      router.push(`/register/create-company?email=${encodeURIComponent(email)}`);
      return;
    }
    router.push(`/register/join-company?email=${encodeURIComponent(email)}`);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Company setup</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">Choose how you want to use the ERP</h1>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <button type="button" className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-blue-600 hover:bg-blue-50" onClick={() => void choose("CREATE_COMPANY")}>
            <div className="text-lg font-semibold text-slate-900">Create a new company</div>
            <div className="mt-2 text-sm text-slate-600">Set up a fresh ERP workspace and invite your team.</div>
          </button>
          <button type="button" className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-blue-600 hover:bg-blue-50" onClick={() => void choose("JOIN_COMPANY")}>
            <div className="text-lg font-semibold text-slate-900">Join an existing company</div>
            <div className="mt-2 text-sm text-slate-600">Accept an invitation and start with your assigned role.</div>
          </button>
        </div>
      </div>
    </main>
  );
}
