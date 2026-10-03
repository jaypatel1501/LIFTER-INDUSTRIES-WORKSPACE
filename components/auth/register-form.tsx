"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrationStartSchema } from "@/lib/validation/auth";

type RegisterFormValues = {
  name: string;
  email: string;
  mobile: string;
  password: string;
  confirmPassword: string;
  preferredLanguage: "ENGLISH" | "HINDI" | "BILINGUAL";
  acceptTerms: boolean;
};

export function RegisterForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registrationStartSchema),
    defaultValues: {
      name: "",
      email: "",
      mobile: "",
      password: "",
      confirmPassword: "",
      preferredLanguage: "ENGLISH",
      acceptTerms: false,
    },
  });

  async function submit(values: RegisterFormValues) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/register/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Registration could not be started.");
      }
      sessionStorage.setItem("erp-registration-password", values.password);
      const query = new URLSearchParams({ email: values.email, mobile: values.mobile });
      router.push(`/register/verify-email?${query.toString()}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registration could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium text-slate-700">Full name</label>
        <Input id="name" autoComplete="name" {...form.register("name")} />
        {form.formState.errors.name && <p className="text-sm text-red-700">{String(form.formState.errors.name.message)}</p>}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">Email address</label>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email && <p className="text-sm text-red-700">{String(form.formState.errors.email.message)}</p>}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="mobile" className="text-sm font-medium text-slate-700">Mobile number</label>
        <Input id="mobile" type="tel" autoComplete="tel" placeholder="+919876543210" {...form.register("mobile")} />
        {form.formState.errors.mobile && <p className="text-sm text-red-700">{String(form.formState.errors.mobile.message)}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
          {form.formState.errors.password && <p className="text-sm text-red-700">{String(form.formState.errors.password.message)}</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-medium text-slate-700">Confirm password</label>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
          {form.formState.errors.confirmPassword && <p className="text-sm text-red-700">{String(form.formState.errors.confirmPassword.message)}</p>}
        </div>
      </div>
      <ul className="space-y-1 text-xs text-slate-600">
        <li>• Minimum 12 characters</li>
        <li>• Uppercase and lowercase</li>
        <li>• Number and symbol</li>
      </ul>
      <div className="space-y-1.5">
        <label htmlFor="preferredLanguage" className="text-sm font-medium text-slate-700">Preferred language</label>
        <select id="preferredLanguage" className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" {...form.register("preferredLanguage")}>
          <option value="ENGLISH">English</option>
          <option value="HINDI">हिन्दी</option>
          <option value="BILINGUAL">English + Hindi</option>
        </select>
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" {...form.register("acceptTerms")} />
        <span>I agree to the terms and privacy policy.</span>
      </label>
      {form.formState.errors.acceptTerms && <p className="text-sm text-red-700">{String(form.formState.errors.acceptTerms.message)}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating account…" : "Create account"}</Button>
      {message && <p className="text-sm text-red-700" role="alert">{message}</p>}
    </form>
  );
}
