"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { resetRequestSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Values = z.input<typeof resetRequestSchema>;

export function ForgotPasswordForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { email: "" },
  });

  async function submit(values: Values) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error("Request failed");
      setMessage("If the account exists, a reset link has been sent.");
    } catch {
      setMessage("The reset service is unavailable. Please retry later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="reset-email" className="text-sm font-medium text-slate-700">Email address</label>
        <Input id="reset-email" type="email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email && <p className="text-sm text-red-700">{form.formState.errors.email.message}</p>}
      </div>
      <Button className="w-full" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
      {message && <p className="text-sm text-slate-600" role="status">{message}</p>}
    </form>
  );
}
