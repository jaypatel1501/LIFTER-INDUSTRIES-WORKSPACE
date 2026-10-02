"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { companyUpdateSchema } from "@/lib/validation/companies";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    company: z.object({
      id: z.string(),
      name: z.string(),
      legalName: z.string().nullable(),
      gstin: z.string().nullable(),
      pan: z.string().nullable(),
      addressLine1: z.string().nullable(),
      addressLine2: z.string().nullable(),
      city: z.string().nullable(),
      state: z.string().nullable(),
      stateCode: z.string().nullable(),
      postalCode: z.string().nullable(),
      country: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      website: z.string().nullable(),
      logoUrl: z.string().nullable(),
      booksBeginningDate: z.string().nullable(),
      financialYearStartMonth: z.number(),
      timezone: z.string(),
      currency: z.string(),
    }),
  }),
});

const formSchema = companyUpdateSchema;
type Values = z.input<typeof formSchema>;

const fields = [
  ["name", "Company name", "कंपनी का नाम"],
  ["legalName", "Legal name", "कानूनी नाम"],
  ["gstin", "GSTIN", "जीएसटीआईएन"],
  ["pan", "PAN", "पैन"],
  ["addressLine1", "Address line 1", "पता पंक्ति 1"],
  ["addressLine2", "Address line 2", "पता पंक्ति 2"],
  ["city", "City", "शहर"],
  ["state", "State", "राज्य"],
  ["stateCode", "GST state code", "जीएसटी राज्य कोड"],
  ["postalCode", "Postal code", "डाक कोड"],
  ["country", "Country", "देश"],
  ["email", "Company email", "कंपनी ईमेल"],
  ["phone", "Phone", "फ़ोन"],
  ["website", "Website", "वेबसाइट"],
  ["currency", "Currency (ISO code)", "मुद्रा (आईएसओ कोड)"],
  ["timezone", "Time zone", "समय क्षेत्र"],
] as const;

export function CompanySettingsForm({ locale, canUpdate }: { locale: Locale; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const query = useQuery({
    queryKey: ["company-settings"],
    queryFn: async () => {
      const response = await fetch("/api/companies/current");
      if (!response.ok) throw new Error("Could not load company settings.");
      return responseSchema.parse(await response.json()).data.company;
    },
  });
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", legalName: "", gstin: "", pan: "", addressLine1: "", addressLine2: "",
      city: "", state: "", stateCode: "", postalCode: "", country: "India", email: "",
      phone: "", website: "", currency: "INR", timezone: "Asia/Kolkata",
      financialYearStartMonth: 4, booksBeginningDate: "",
    },
  });

  useEffect(() => {
    if (!query.data) return;
    const company = query.data;
    form.reset({
      name: company.name,
      legalName: company.legalName ?? "",
      gstin: company.gstin ?? "",
      pan: company.pan ?? "",
      addressLine1: company.addressLine1 ?? "",
      addressLine2: company.addressLine2 ?? "",
      city: company.city ?? "",
      state: company.state ?? "",
      stateCode: company.stateCode ?? "",
      postalCode: company.postalCode ?? "",
      country: company.country,
      email: company.email ?? "",
      phone: company.phone ?? "",
      website: company.website ?? "",
      currency: company.currency,
      timezone: company.timezone,
      financialYearStartMonth: company.financialYearStartMonth,
      booksBeginningDate: company.booksBeginningDate?.slice(0, 10) ?? "",
    });
  }, [form, query.data]);

  async function submit(values: Values) {
    setMessage("");
    try {
      const response = await fetch("/api/companies/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Could not save company settings.");
      }
      await queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      setMessage(managementCopy(locale, "Company settings saved.", "कंपनी सेटिंग सहेजी गई।"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save company settings.");
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setLogoBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.set("logo", file);
      const response = await fetch("/api/companies/current/logo", { method: "POST", body });
      if (!response.ok) {
        const result = await response.json() as { error?: { message?: string } };
        throw new Error(result.error?.message ?? "Could not upload company logo.");
      }
      await queryClient.invalidateQueries({ queryKey: ["company-settings"] });
      setMessage(managementCopy(locale, "Company logo updated.", "कंपनी का लोगो अपडेट हुआ।"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload company logo.");
    } finally {
      setLogoBusy(false);
    }
  }

  if (query.isPending) return <p role="status">{managementCopy(locale, "Loading company settings…", "कंपनी सेटिंग लोड हो रही हैं…")}</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{managementCopy(locale, "Company logo", "कंपनी का लोगो")}</h2>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div
            role="img"
            aria-label={managementCopy(locale, "Company logo preview", "कंपनी लोगो पूर्वावलोकन")}
            className="size-20 rounded-lg border border-slate-200 bg-contain bg-center bg-no-repeat"
            style={query.data.logoUrl ? { backgroundImage: 'url("/api/companies/current/logo")' } : undefined}
          />
          {canUpdate && <label className="grid gap-2 text-sm text-slate-600">
            {managementCopy(locale, "PNG, JPEG or WebP; up to 2 MB", "PNG, JPEG या WebP; 2 MB तक")}
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={logoBusy}
              onChange={(event) => void uploadLogo(event.target.files?.[0])}
            />
          </label>
          }
        </div>
      </section>

      <form onSubmit={form.handleSubmit(submit)} className="space-y-6">
        <fieldset disabled={!canUpdate} className="space-y-6 disabled:opacity-80">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">{managementCopy(locale, "Company identity and contact", "कंपनी की पहचान और संपर्क")}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {fields.map(([name, english, hindi]) => (
              <label key={name} className="grid gap-1.5 text-sm font-medium text-slate-700">
                {managementCopy(locale, english, hindi)}
                <Input autoComplete={name === "email" ? "email" : name === "phone" ? "tel" : undefined} {...form.register(name)} />
                {form.formState.errors[name]?.message && (
                  <span className="text-xs font-normal text-red-700">{String(form.formState.errors[name]?.message)}</span>
                )}
              </label>
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">{managementCopy(locale, "Books and financial year", "लेखा पुस्तकें और वित्तीय वर्ष")}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              {managementCopy(locale, "Financial year starts in month (1–12)", "वित्तीय वर्ष का प्रारंभ माह (1–12)")}
              <Input type="number" min={1} max={12} {...form.register("financialYearStartMonth", { valueAsNumber: true })} />
              {form.formState.errors.financialYearStartMonth?.message && <span className="text-xs text-red-700">{form.formState.errors.financialYearStartMonth.message}</span>}
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              {managementCopy(locale, "Books beginning date", "लेखा पुस्तकों की प्रारंभ तिथि")}
              <Input type="date" {...form.register("booksBeginningDate")} />
              {form.formState.errors.booksBeginningDate?.message && <span className="text-xs text-red-700">{form.formState.errors.booksBeginningDate.message}</span>}
            </label>
          </div>
        </section>
        {canUpdate && <div className="flex items-center gap-4">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? managementCopy(locale, "Saving…", "सहेजा जा रहा है…")
              : managementCopy(locale, "Save company settings", "कंपनी सेटिंग सहेजें")}
          </Button>
          {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
        </div>}
        {!canUpdate && <p className="text-sm text-slate-600">{managementCopy(locale, "You have read-only company access.", "आपके पास केवल-पढ़ने की कंपनी पहुँच है।")}</p>}
        </fieldset>
      </form>
    </div>
  );
}
