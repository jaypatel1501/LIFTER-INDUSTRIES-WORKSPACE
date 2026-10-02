"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Locale } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { getDictionary } from "@/lib/i18n";

const schema = z.object({ locale: z.enum(["EN", "HI", "BILINGUAL"]) });
type Values = z.infer<typeof schema>;

export function LocaleForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const { update } = useSession();
  const [message, setMessage] = useState("");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { locale },
  });
  const copy = getDictionary(locale);

  async function submit(values: Values) {
    setMessage("");
    try {
      const response = await fetch("/api/profile/locale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error("Preference update failed");
      await update();
      router.refresh();
      setMessage("Language preference saved.");
    } catch {
      setMessage("Could not save your language preference.");
    }
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
      <div className="max-w-sm space-y-1.5">
        <label htmlFor="preference-locale" className="text-sm font-medium text-slate-700">{copy.language}</label>
        <select
          id="preference-locale"
          className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          {...form.register("locale")}
        >
          <option value="EN">English</option>
          <option value="HI">हिंदी</option>
          <option value="BILINGUAL">English · हिंदी</option>
        </select>
      </div>
      <Button type="submit" disabled={form.formState.isSubmitting}>{copy.savePreference}</Button>
      {message && <p className="text-sm text-slate-600" role="status">{message}</p>}
    </form>
  );
}
