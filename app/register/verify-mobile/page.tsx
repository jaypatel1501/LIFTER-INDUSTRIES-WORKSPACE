"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function VerifyMobilePage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12"><div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-slate-600">Loading…</div></main>}>
      <VerifyMobileContent />
    </Suspense>
  );
}

function VerifyMobileContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Enter the six-digit code sent to your mobile number.");
  const email = searchParams.get("email") ?? "";
  const mobile = searchParams.get("mobile") ?? "";

  async function sendOtp() {
    setBusy(true);
    setMessage("Sending your OTP…");
    try {
      const response = await fetch("/api/auth/register/send-mobile-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "We could not send the OTP.");
      if (body?.data?.code) {
        setMessage(`Development OTP mode is active. Use code: ${body.data.code}`);
      } else {
        setMessage("A verification code has been sent to your mobile number.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not send the OTP.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    setMessage("Verifying your mobile number…");
    try {
      const response = await fetch("/api/auth/register/verify-mobile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, code }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "OTP verification failed.");
      router.push(`/register/company-choice?email=${encodeURIComponent(email)}&mobile=${encodeURIComponent(mobile)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OTP verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Verify Mobile</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">One-time passcode</h1>
        <p className="mt-2 text-sm text-slate-600">{mobile || "Your mobile number"}</p>
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{message}</div>
        <div className="mt-6 space-y-4">
          <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} inputMode="numeric" className="h-12 w-full rounded-lg border border-slate-300 px-3 text-lg tracking-[0.5em]" placeholder="123456" />
          <div className="flex gap-3">
            <button type="button" className="flex-1 rounded-lg bg-blue-700 px-4 py-3 font-medium text-white disabled:opacity-60" disabled={busy || code.length !== 6} onClick={() => verifyOtp()}>Verify mobile</button>
            <button type="button" className="rounded-lg border border-slate-300 px-4 py-3 font-medium text-slate-700" disabled={busy} onClick={() => sendOtp()}>Resend</button>
          </div>
        </div>
      </div>
    </main>
  );
}
