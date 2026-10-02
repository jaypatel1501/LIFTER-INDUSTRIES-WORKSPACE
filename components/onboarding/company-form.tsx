"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { companySchema } from "@/lib/validation/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Locale } from "@prisma/client";
import { getDictionary } from "@/lib/i18n";

type Values = z.input<typeof companySchema>;

export function CompanyForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const { update } = useSession();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(companySchema),
    defaultValues: { name: "", legalName: "", gstin: "" },
  });
  const copy = getDictionary(locale);

  async function submit(values: Values) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json() as {
        data?: { id: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Company workspace could not be created.");
      }
      await update();
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Company workspace could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="company-name" className="text-sm font-medium text-slate-700">{copy.displayName}</label>
        <Input id="company-name" autoComplete="organization" {...form.register("name")} />
        {form.formState.errors.name && <p className="text-sm text-red-700">{form.formState.errors.name.message}</p>}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="legal-name" className="text-sm font-medium text-slate-700">{copy.legalName} <span className="text-slate-400">({copy.optional})</span></label>
        <Input id="legal-name" autoComplete="organization-title" {...form.register("legalName")} />
        {form.formState.errors.legalName && <p className="text-sm text-red-700">{form.formState.errors.legalName.message}</p>}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="gstin" className="text-sm font-medium text-slate-700">{copy.gstin} <span className="text-slate-400">({copy.optional})</span></label>
        <Input id="gstin" maxLength={15} autoCapitalize="characters" {...form.register("gstin")} />
        {form.formState.errors.gstin && <p className="text-sm text-red-700">Enter a valid 15-character GSTIN.</p>}
      </div>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? copy.creatingWorkspace : copy.createCompany}</Button>
      {message && <p className="text-sm text-red-700" role="alert">{message}</p>}
    </form>
  );
}
