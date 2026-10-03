"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

export default function InvitePage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12"><div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-slate-600">Loading…</div></main>}>
      <InviteContent />
    </Suspense>
  );
}

function InviteContent() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Validating invitation…");
  const [companyName, setCompanyName] = useState("");
  const [inviterName, setInviterName] = useState("");

  useEffect(() => {
    const token = params.token;
    if (!token) return;
    (async () => {
      try {
        const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? "This invitation is invalid or expired.");
        setCompanyName(body?.data?.companyName ?? "Your company");
        setInviterName(body?.data?.inviterName ?? "A company administrator");
        setMessage(`You were invited to join ${body?.data?.companyName ?? "your company"}.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "This invitation is invalid or expired.");
      }
    })();
  }, [params.token]);

  async function acceptInvitation() {
    const token = params.token;
    const response = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: searchParams.get("email") ?? undefined }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body?.error?.message ?? "Invitation could not be accepted.");
      return;
    }
    router.push("/register/complete");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Company invitation</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">{companyName || "Invitation"}</h1>
        <p className="mt-3 text-slate-600">{message}</p>
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">Invited by {inviterName || "your administrator"}</div>
        <div className="mt-6 flex gap-3">
          <button type="button" className="flex-1 rounded-lg bg-blue-700 px-4 py-3 font-medium text-white" onClick={() => void acceptInvitation()}>Accept invitation</button>
          <button type="button" className="rounded-lg border border-slate-300 px-4 py-3 font-medium text-slate-700" onClick={() => router.push("/login")}>Cancel</button>
        </div>
      </div>
    </main>
  );
}
