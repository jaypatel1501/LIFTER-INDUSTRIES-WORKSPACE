"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { unitConversionCreateSchema, unitCreateSchema } from "@/lib/validation/inventory";

const unitsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    units: z.array(z.object({
      id: z.string(), name: z.string(), symbol: z.string(), precision: z.number(),
      _count: z.object({ itemBaseUnits: z.number(), itemConversions: z.number() }),
    })),
    conversions: z.array(z.object({
      id: z.string(), factor: z.string(),
      fromUnit: z.object({ id: z.string(), name: z.string(), symbol: z.string() }),
      toUnit: z.object({ id: z.string(), name: z.string(), symbol: z.string() }),
    })),
  }),
});
type UnitForm = z.input<typeof unitCreateSchema>;
type ConversionForm = z.input<typeof unitConversionCreateSchema>;

export function UnitsManager({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["inventory-units"],
    queryFn: async () => {
      const response = await fetch("/api/inventory/units");
      if (!response.ok) throw new Error("Could not load units.");
      return unitsResponseSchema.parse(await response.json()).data;
    },
  });
  const unitForm = useForm<UnitForm>({
    resolver: zodResolver(unitCreateSchema),
    defaultValues: { name: "", symbol: "", precision: 2 },
  });
  const conversionForm = useForm<ConversionForm>({
    resolver: zodResolver(unitConversionCreateSchema),
    defaultValues: { fromUnitId: "", toUnitId: "", factor: "" },
  });
  const saveUnit = useMutation({
    mutationFn: async (values: UnitForm) => {
      const response = await fetch("/api/inventory/units", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not create unit.");
    },
    onSuccess: async () => { unitForm.reset(); setMessage(copy("Unit created.", "इकाई बनाई गई।")); await client.invalidateQueries({ queryKey: ["inventory-units"] }); },
    onError: (error) => setMessage(error.message),
  });
  const saveConversion = useMutation({
    mutationFn: async (values: ConversionForm) => {
      const response = await fetch("/api/inventory/units/conversions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not create conversion.");
    },
    onSuccess: async () => { conversionForm.reset({ fromUnitId: "", toUnitId: "", factor: "" }); setMessage(copy("Conversion created.", "रूपांतरण बनाया गया।")); await client.invalidateQueries({ queryKey: ["inventory-units"] }); },
    onError: (error) => setMessage(error.message),
  });
  const units = (query.data?.units ?? []).filter((unit) => !search || `${unit.name} ${unit.symbol}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">{copy("Units and conversions", "इकाइयाँ और रूपांतरण")}</h1><p className="mt-2 text-sm text-slate-600">{copy("Define the precision used for stock quantities and explicit cross-unit conversion factors.", "स्टॉक मात्रा की सटीकता और इकाइयों के बीच रूपांतरण निर्धारित करें।")}</p></header>
    {canManage && <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">{copy("Create unit", "इकाई बनाएँ")}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={unitForm.handleSubmit((values) => saveUnit.mutate(values))}>
          <label className="grid gap-1 text-sm">{copy("Name", "नाम")}<Input {...unitForm.register("name")} /></label>
          <label className="grid gap-1 text-sm">{copy("Symbol", "प्रतीक")}<Input {...unitForm.register("symbol")} /></label>
          <label className="grid gap-1 text-sm">{copy("Decimal places", "दशमलव स्थान")}<Input type="number" min="0" max="6" {...unitForm.register("precision", { valueAsNumber: true })} /></label>
          <div className="flex items-end"><Button disabled={saveUnit.isPending}>{copy("Save unit", "इकाई सहेजें")}</Button></div>
        </form>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">{copy("Add conversion", "रूपांतरण जोड़ें")}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={conversionForm.handleSubmit((values) => saveConversion.mutate(values))}>
          <label className="grid gap-1 text-sm">{copy("From", "से")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...conversionForm.register("fromUnitId")}><option value="">{copy("Choose unit", "इकाई चुनें")}</option>{query.data?.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></label>
          <label className="grid gap-1 text-sm">{copy("To", "तक")}<select className="h-11 rounded-lg border border-slate-300 px-3" {...conversionForm.register("toUnitId")}><option value="">{copy("Choose unit", "इकाई चुनें")}</option>{query.data?.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></label>
          <label className="grid gap-1 text-sm">{copy("Factor (1 from = factor to)", "गुणक (1 से = इतने तक)")}<Input inputMode="decimal" {...conversionForm.register("factor")} /></label>
          <div className="flex items-end"><Button disabled={saveConversion.isPending || (query.data?.units.length ?? 0) < 2}>{copy("Save conversion", "रूपांतरण सहेजें")}</Button></div>
        </form>
      </section>
    </div>}
    {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
    {saveUnit.isError && <p role="alert" className="text-sm text-red-700">{saveUnit.error.message}</p>}
    {saveConversion.isError && <p role="alert" className="text-sm text-red-700">{saveConversion.error.message}</p>}
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <label className="grid max-w-lg gap-1 text-sm">{copy("Search units", "इकाइयाँ खोजें")}<Input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {query.isPending && <p role="status" className="py-8">{copy("Loading units…", "इकाइयाँ लोड हो रही हैं…")}</p>}
      {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
      {query.data && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b text-slate-500"><th className="p-3">{copy("Unit", "इकाई")}</th><th className="p-3">{copy("Precision", "सटीकता")}</th><th className="p-3">{copy("Base items", "मूल आइटम")}</th><th className="p-3">{copy("Alternate uses", "वैकल्पिक उपयोग")}</th></tr></thead><tbody>{units.map((unit) => <tr key={unit.id} className="border-b last:border-0"><td className="p-3 font-medium">{unit.name} ({unit.symbol})</td><td className="p-3">{unit.precision}</td><td className="p-3">{unit._count.itemBaseUnits}</td><td className="p-3">{unit._count.itemConversions}</td></tr>)}</tbody></table></div>}
      {query.data && units.length === 0 && <p className="py-6 text-sm text-slate-500">{copy("No units match this search.", "इस खोज से कोई इकाई मेल नहीं खाती।")}</p>}
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">{copy("Generic conversions", "सामान्य रूपांतरण")}</h2>
      {!query.data?.conversions.length && <p className="py-5 text-sm text-slate-500">{copy("No generic conversions configured.", "कोई सामान्य रूपांतरण निर्धारित नहीं है।")}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{query.data?.conversions.map((conversion) => <p key={conversion.id} className="rounded-lg bg-slate-50 p-3 text-sm">1 {conversion.fromUnit.symbol} = {conversion.factor} {conversion.toUnit.symbol}</p>)}</div>
    </section>
  </div>;
}
