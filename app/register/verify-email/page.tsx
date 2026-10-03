"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12"><div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-slate-600">Loading…</div></main>}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("A verification link has been sent to your email.");
  const email = searchParams.get("email") ?? "";
  const mobile = searchParams.get("mobile") ?? "";
  const token = searchParams.get("token") ?? "";

  useEffect(() => {
    if (!token) return;
    (async () => {
      setBusy(true);
      setMessage("Verifying your email…");
      try {
        const response = await fetch("/api/auth/register/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? "The verification link is invalid or expired.");
        router.push(`/register/verify-mobile?email=${encodeURIComponent(email)}&mobile=${encodeURIComponent(mobile)}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "The verification link is invalid or expired.");
      } finally {
        setBusy(false);
      }
    })();
  }, [email, mobile, router, token]);

  async function resend() {
    setBusy(true);
    setMessage("Sending a fresh verification email…");
    try {
      const response = await fetch("/api/auth/register/resend-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "We could not resend the verification email.");
      setMessage(body?.data?.message ?? "A new verification email has been sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not resend the verification email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Verify Email</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Check your inbox</h1>
        <p className="mt-2 text-sm text-slate-600">We sent a secure verification link to {email || "your email"}.</p>
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{message}</div>
        <div className="mt-6 flex gap-3">
          <button type="button" className="flex-1 rounded-lg bg-blue-700 px-4 py-3 font-medium text-white disabled:opacity-60" disabled={busy} onClick={() => resend()}>{busy ? "Working…" : "Resend verification email"}</button>
          <button type="button" className="rounded-lg border border-slate-300 px-4 py-3 font-medium text-slate-700" onClick={() => router.push("/login")}>Back to sign in</button>
        </div>
      </div>
    </main>
  );
}
