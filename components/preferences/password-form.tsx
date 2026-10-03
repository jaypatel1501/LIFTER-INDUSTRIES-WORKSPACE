"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { passwordChangeSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDictionary } from "@/lib/i18n";
import type { Locale } from "@prisma/client";

type Values = z.input<typeof passwordChangeSchema>;

export function PasswordForm({ locale }: { locale: Locale }) {
  const [message, setMessage] = useState("");
  const copy = getDictionary(locale);
  const form = useForm<Values>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  async function submit(values: Values) {
    setMessage("");
    try {
      const response = await fetch("/api/auth/password-change", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setMessage(body.error?.message ?? "Password could not be changed.");
        return;
      }
      await signOut({ redirectTo: "/login" });
    } catch {
      setMessage("Password could not be changed. Please retry.");
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="max-w-md space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="current-password" className="text-sm font-medium text-slate-700">{copy.currentPassword}</label>
        <Input id="current-password" type="password" autoComplete="current-password" {...form.register("currentPassword")} />
        {form.formState.errors.currentPassword && <p className="text-sm text-red-700">{form.formState.errors.currentPassword.message}</p>}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="new-password" className="text-sm font-medium text-slate-700">{copy.newPassword}</label>
        <Input id="new-password" type="password" autoComplete="new-password" {...form.register("newPassword")} />
        {form.formState.errors.newPassword && <p className="text-sm text-red-700">{form.formState.errors.newPassword.message}</p>}
        <p className="text-xs leading-5 text-slate-500">{copy.passwordHint}</p>
      </div>
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? copy.changingPassword : copy.changePassword}
      </Button>
      {message && <p className="text-sm text-red-700" role="alert">{message}</p>}
    </form>
  );
}
