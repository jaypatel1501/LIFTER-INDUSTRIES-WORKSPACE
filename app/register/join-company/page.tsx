"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function JoinCompanyPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12"><div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-slate-600">Loading…</div></main>}>
      <JoinCompanyContent />
    </Suspense>
  );
}

function JoinCompanyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [token, setToken] = useState("");
  const email = searchParams.get("email") ?? "";

  async function continueToInvitation() {
    const cleaned = token.trim();
    if (!cleaned) return;
    router.push(`/invite/${encodeURIComponent(cleaned)}?email=${encodeURIComponent(email)}`);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Join company</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Use your invitation link</h1>
        <p className="mt-2 text-sm text-slate-600">Paste the invitation token or open the link shared by your manager.</p>
        <div className="mt-6 space-y-4">
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Invitation token" className="h-12 w-full rounded-lg border border-slate-300 px-3" />
          <button type="button" className="w-full rounded-lg bg-blue-700 px-4 py-3 font-medium text-white" onClick={() => void continueToInvitation()}>Continue</button>
        </div>
      </div>
    </main>
  );
}
