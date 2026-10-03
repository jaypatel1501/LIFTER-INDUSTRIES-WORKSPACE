"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { partyUpdateSchema } from "@/lib/validation/accounting";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    party: z.object({
      id: z.string(), type: z.enum(["CUSTOMER", "SUPPLIER"]), name: z.string(),
      contactName: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable(),
      mobile: z.string().nullable(), gstin: z.string().nullable(), pan: z.string().nullable(),
      addressLine1: z.string().nullable(), addressLine2: z.string().nullable(), city: z.string().nullable(),
      state: z.string().nullable(), stateCode: z.string().nullable(), postalCode: z.string().nullable(),
      country: z.string(), creditPeriodDays: z.number(), creditLimit: z.string(), isActive: z.boolean(),
      ledger: z.object({
        id: z.string(), name: z.string(), group: z.object({ name: z.string() }),
        balanceDebit: z.string(), balanceCredit: z.string(),
        voucherLines: z.array(z.object({
          id: z.string(), debit: z.string(), credit: z.string(),
          voucher: z.object({ id: z.string(), voucherNumber: z.string(), type: z.string(), voucherDate: z.string(), narration: z.string().nullable() }),
          billDetails: z.array(z.object({ id: z.string(), referenceNumber: z.string(), dueDate: z.string(), amount: z.string() })),
        })),
      }).nullable(),
    }),
  }),
});

export function PartyDetail({ locale, partyId, canUpdate }: { locale: Locale; partyId: string; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const query = useQuery({
    queryKey: ["accounting-party", partyId],
    queryFn: async () => {
      const response = await fetch(`/api/accounting/parties/${partyId}`);
      if (!response.ok) throw new Error(response.status === 404 ? "Party not found." : "Could not load party.");
      return responseSchema.parse(await response.json()).data.party;
    },
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = partyUpdateSchema.safeParse({
        contactName: fields.contactName ?? query.data?.contactName ?? "",
        email: fields.email ?? query.data?.email ?? "",
        phone: fields.phone ?? query.data?.phone ?? "",
        mobile: fields.mobile ?? query.data?.mobile ?? "",
        gstin: fields.gstin ?? query.data?.gstin ?? "",
        pan: fields.pan ?? query.data?.pan ?? "",
        addressLine1: fields.addressLine1 ?? query.data?.addressLine1 ?? "",
        addressLine2: fields.addressLine2 ?? query.data?.addressLine2 ?? "",
        city: fields.city ?? query.data?.city ?? "",
        state: fields.state ?? query.data?.state ?? "",
        stateCode: fields.stateCode ?? query.data?.stateCode ?? "",
        postalCode: fields.postalCode ?? query.data?.postalCode ?? "",
        country: fields.country ?? query.data?.country ?? "India",
        creditPeriodDays: Number(fields.creditPeriodDays ?? query.data?.creditPeriodDays ?? 0),
        creditLimit: fields.creditLimit ?? query.data?.creditLimit ?? "0",
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the entered fields.");
      const response = await fetch(`/api/accounting/parties/${partyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update party.");
    },
    onSuccess: async () => {
      setMessage(copy("Party details updated.", "पार्टी विवरण अपडेट हुआ।"));
      await queryClient.invalidateQueries({ queryKey: ["accounting-party", partyId] });
    },
    onError: (error) => setMessage(error.message),
  });
  const statusMutation = useMutation({
    mutationFn: async () => {
      const parsed = partyUpdateSchema.safeParse({ isActive: !query.data?.isActive });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid party status.");
      const response = await fetch(`/api/accounting/parties/${partyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update party status.");
    },
    onSuccess: async () => {
      setMessage(copy("Party status updated.", "पार्टी स्थिति अपडेट हुई।"));
      await queryClient.invalidateQueries({ queryKey: ["accounting-party", partyId] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-parties"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const update = (key: string, value: string) => setFields((current) => ({ ...current, [key]: value }));

  if (query.isPending) return <p role="status">{copy("Loading party…", "पार्टी लोड हो रही है…")}</p>;
  if (query.isError) return <p role="alert" className="text-red-700">{query.error.message}</p>;
  const party = query.data;
  const input = (key: string, label: string, value: string | null, type = "text") => (
    <label className="grid gap-1 text-sm">{copy(label, ({
      "Contact person": "संपर्क व्यक्ति", Email: "ईमेल", Phone: "फ़ोन", Mobile: "मोबाइल",
      GSTIN: "जीएसटीआईएन", PAN: "पैन", "Address line 1": "पता पंक्ति 1", "Address line 2": "पता पंक्ति 2",
      City: "शहर", State: "राज्य", "State code": "राज्य कोड", "Postal code": "पिन कोड", Country: "देश",
    } as Record<string, string>)[label] ?? label)}<Input type={type} value={fields[key] ?? value ?? ""} onChange={(event) => update(key, event.target.value)} /></label>
  );
  return (
    <div className="space-y-6">
      <header>
        <Link href="/dashboard/parties" className="text-sm text-blue-700 hover:underline">← {copy("Customers & suppliers", "ग्राहक और आपूर्तिकर्ता")}</Link>
        <h1 className="mt-2 text-2xl font-semibold">{party.name}</h1>
        <p className="mt-1 text-sm text-slate-600">{party.type === "CUSTOMER" ? copy("Customer", "ग्राहक") : copy("Supplier", "आपूर्तिकर्ता")} · {party.isActive ? copy("Active", "सक्रिय") : copy("Inactive", "निष्क्रिय")}</p>
      </header>
      {canUpdate && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Party and tax details", "पार्टी और कर विवरण")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {input("contactName", "Contact person", party.contactName)}
          {input("email", "Email", party.email, "email")}
          {input("phone", "Phone", party.phone)}
          {input("mobile", "Mobile", party.mobile)}
          {input("gstin", "GSTIN", party.gstin)}
          {input("pan", "PAN", party.pan)}
          {input("addressLine1", "Address line 1", party.addressLine1)}
          {input("addressLine2", "Address line 2", party.addressLine2)}
          {input("city", "City", party.city)}
          {input("state", "State", party.state)}
          {input("stateCode", "State code", party.stateCode)}
          {input("postalCode", "Postal code", party.postalCode)}
          {input("country", "Country", party.country)}
          <label className="grid gap-1 text-sm">{copy("Credit period (days)", "उधार अवधि (दिन)")}<Input type="number" min={0} value={fields.creditPeriodDays ?? String(party.creditPeriodDays)} onChange={(event) => update("creditPeriodDays", event.target.value)} /></label>
          <label className="grid gap-1 text-sm">{copy("Credit limit", "उधार सीमा")}<Input inputMode="decimal" value={fields.creditLimit ?? party.creditLimit} onChange={(event) => update("creditLimit", event.target.value)} /></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>{copy(mutation.isPending ? "Saving…" : "Save details", mutation.isPending ? "सहेजा जा रहा है…" : "विवरण सहेजें")}</Button>
          <Button type="button" variant="secondary" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate()}>{copy(party.isActive ? "Deactivate party" : "Activate party", party.isActive ? "पार्टी निष्क्रिय करें" : "पार्टी सक्रिय करें")}</Button>
          {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
        </div>
      </section>}
      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">{copy("Credit terms", "उधार शर्तें")}</h2>
          <p className="mt-3 text-sm">{copy("Credit period", "उधार अवधि")}: {party.creditPeriodDays} {copy("days", "दिन")}</p>
          <p className="mt-1 text-sm">{copy("Credit limit", "उधार सीमा")}: {party.creditLimit}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">{copy("Linked ledger", "संबंधित खाता")}</h2>
          {party.ledger ? <><Link className="mt-3 inline-block text-blue-700 hover:underline" href={`/dashboard/ledgers/${party.ledger.id}`}>{party.ledger.name}</Link><p className="mt-1 text-sm text-slate-500">{party.ledger.group.name}</p><p className="mt-2 text-sm">{copy("Debit balance", "नामे शेष")}: {party.ledger.balanceDebit} · {copy("Credit balance", "जमा शेष")}: {party.ledger.balanceCredit}</p></> : <p className="mt-2 text-sm text-red-700">{copy("No linked ledger is present.", "संबंधित खाता उपलब्ध नहीं है।")}</p>}
        </article>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Recent voucher history", "हाल के वाउचर")}</h2>
        {!party.ledger?.voucherLines.length && <p className="py-6 text-sm text-slate-500">{copy("No posted entries yet.", "अभी कोई पोस्ट की गई प्रविष्टि नहीं है।")}</p>}
        {party.ledger?.voucherLines.map((line) => <article key={line.id} className="mt-3 rounded-lg border border-slate-100 p-4">
          <div className="flex flex-wrap justify-between gap-2"><strong>{line.voucher.voucherNumber}</strong><span className="text-sm text-slate-500">{new Intl.DateTimeFormat(locale === "HI" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(line.voucher.voucherDate))}</span></div>
          <p className="mt-1 text-sm">{line.voucher.type} · {line.voucher.narration ?? "—"} · {copy("Debit", "नामे")} {line.debit} · {copy("Credit", "जमा")} {line.credit}</p>
          {line.billDetails.map((bill) => <p key={bill.id} className="mt-2 text-xs text-slate-600">{bill.referenceNumber} · {bill.amount} · {new Intl.DateTimeFormat(locale === "HI" ? "hi-IN" : "en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(bill.dueDate))}</p>)}
        </article>)}
      </section>
    </div>
  );
}
