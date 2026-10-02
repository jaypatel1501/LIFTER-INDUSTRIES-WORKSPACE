"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { passwordLoginSchema, otpRequestSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LoginValues = z.input<typeof passwordLoginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [message, setMessage] = useState("");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(passwordLoginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function submitPassword(values: LoginValues) {
    setBusy(true);
    setMessage("");
    try {
      const result = await signIn("credentials", {
        ...values,
        redirect: false,
        redirectTo: "/dashboard",
      });
      if (result?.error) {
        setMessage("Email or password is incorrect, or the account is temporarily locked.");
        return;
      }
      router.push(result?.url ?? "/dashboard");
      router.refresh();
    } catch {
      setMessage("Sign-in failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp() {
    const parsed = otpRequestSchema.safeParse({ mobile });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Enter a valid mobile number.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) throw new Error("OTP request failed");
      setOtpSent(true);
      setMessage("If the mobile number is registered, a code has been sent.");
    } catch {
      setMessage("Could not send a code. Please retry later.");
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await signIn("otp", {
        mobile,
        code,
        redirect: false,
        redirectTo: "/dashboard",
      });
      if (result?.error) {
        setMessage("The code is invalid, expired, or has already been used.");
        return;
      }
      router.push(result?.url ?? "/dashboard");
      router.refresh();
    } catch {
      setMessage("Sign-in failed. Please request a new code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          onClick={() => { setMode("password"); setMessage(""); }}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === "password" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
        >
          Email
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "otp"}
          onClick={() => { setMode("otp"); setMessage(""); }}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === "otp" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
        >
          Mobile OTP
        </button>
      </div>
      {mode === "password" ? (
        <form key="password-login" className="space-y-4" onSubmit={form.handleSubmit(submitPassword)} noValidate>
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">Email address</label>
            <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
            {form.formState.errors.email && <p className="text-sm text-red-700">{form.formState.errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
            <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
            {form.formState.errors.password && <p className="text-sm text-red-700">{form.formState.errors.password.message}</p>}
          </div>
          <div className="text-right">
            <a href="/forgot-password" className="text-sm font-medium text-blue-700 hover:underline">Forgot password?</a>
          </div>
          <Button className="w-full" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      ) : (
        <form key="otp-login" className="space-y-4" onSubmit={submitOtp} noValidate>
          <div className="space-y-1.5">
            <label htmlFor="mobile" className="text-sm font-medium text-slate-700">Mobile number</label>
            <Input
              id="mobile"
              type="tel"
              autoComplete="tel"
              placeholder="+919876543210"
              value={mobile}
              onChange={(event) => { setMobile(event.target.value); setOtpSent(false); }}
            />
          </div>
          {otpSent && (
            <div className="space-y-1.5">
              <label htmlFor="otp-code" className="text-sm font-medium text-slate-700">6-digit code</label>
              <Input
                id="otp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              />
            </div>
          )}
          {otpSent ? (
            <div className="flex gap-2">
              <Button className="flex-1" type="submit" disabled={busy || code.length !== 6}>Verify and sign in</Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void requestOtp()}>Resend</Button>
            </div>
          ) : (
            <Button className="w-full" type="button" disabled={busy} onClick={() => void requestOtp()}>
              Send verification code
            </Button>
          )}
        </form>
      )}
      {message && <p className="mt-4 text-sm text-slate-600" role="status" aria-live="polite">{message}</p>}
    </div>
  );
}
