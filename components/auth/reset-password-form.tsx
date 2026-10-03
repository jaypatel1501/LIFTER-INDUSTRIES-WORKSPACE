"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { resetCompleteSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Values = z.input<typeof resetCompleteSchema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(resetCompleteSchema),
    defaultValues: { token, password: "" },
  });

  async function submit(values: Values) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Password could not be updated.");
      setMessage("Password updated. Redirecting to sign in…");
      window.setTimeout(() => router.replace("/login"), 1200);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Password could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="new-password" className="text-sm font-medium text-slate-700">New password</label>
        <Input id="new-password" type="password" autoComplete="new-password" {...form.register("password")} />
        {form.formState.errors.password && <p className="text-sm text-red-700">{form.formState.errors.password.message}</p>}
        <p className="text-xs leading-5 text-slate-500">Use 12+ characters with uppercase, lowercase, a number and a symbol.</p>
      </div>
      <Button className="w-full" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</Button>
      {message && <p className="text-sm text-slate-600" role="status">{message}</p>}
    </form>
  );
}
