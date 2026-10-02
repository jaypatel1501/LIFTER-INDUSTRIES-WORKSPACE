"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { partyCreateSchema } from "@/lib/validation/accounting";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    parties: z.array(z.object({
      id: z.string(), type: z.enum(["CUSTOMER", "SUPPLIER"]), name: z.string(),
      gstin: z.string().nullable(), state: z.string().nullable(),
      creditPeriodDays: z.number(), creditLimit: z.string(), isActive: z.boolean(),
      ledger: z.object({ id: z.string(), name: z.string(), group: z.object({ id: z.string(), name: z.string() }) }).nullable(),
    })),
    total: z.number(), page: z.number(), pageSize: z.number(),
  }),
});
type FormValues = z.input<typeof partyCreateSchema>;

export function PartiesManager({ locale, canCreate, companyName, booksBeginningDate }: {
  locale: Locale; canCreate: boolean; companyName: string; booksBeginningDate: string;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const query = useQuery({
    queryKey: ["accounting-parties", search, type, status, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search) params.set("search", search);
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      const response = await fetch(`/api/accounting/parties?${params}`);
      if (!response.ok) throw new Error("Could not load customers and suppliers.");
      return responseSchema.parse(await response.json()).data;
    },
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(partyCreateSchema),
    defaultValues: {
      type: "CUSTOMER", name: "", contactName: "", email: "", phone: "", mobile: "",
      gstin: "", pan: "", addressLine1: "", addressLine2: "", city: "", state: "",
      stateCode: "", postalCode: "", country: "India", creditPeriodDays: 0,
      creditLimit: "0",
      openingBalance: {
        amount: "0", side: "DEBIT", date: booksBeginningDate || new Date().toISOString().slice(0, 10), bills: [],
      },
    },
  });
  const bills = useFieldArray({ control: form.control, name: "openingBalance.bills" });
  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await fetch("/api/accounting/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(values),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save party.");
    },
    onSuccess: async () => {
      form.reset();
      setMessage(copy("Party created with a linked ledger.", "पार्टी और संबंधित खाता बनाया गया।"));
      await queryClient.invalidateQueries({ queryKey: ["accounting-parties"] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-ledgers"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-blue-700">{companyName}</p>
        <h1 className="mt-1 text-2xl font-semibold">{copy("Customers & suppliers", "ग्राहक और आपूर्तिकर्ता")}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy("Party records create a linked receivable or payable ledger. Opening balances are posted as balanced, auditable vouchers.", "पार्टी रिकॉर्ड से संबंधित प्राप्य या देय खाता बनता है। प्रारंभिक शेष संतुलित और ऑडिटेड वाउचर के रूप में पोस्ट होता है।")}</p>
      </header>
      {canCreate && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Add a customer or supplier", "ग्राहक या आपूर्तिकर्ता जोड़ें")}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
          <label className="grid gap-1 text-sm">{copy("Party type", "पार्टी प्रकार")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" {...form.register("type")}>
              <option value="CUSTOMER">{copy("Customer", "ग्राहक")}</option>
              <option value="SUPPLIER">{copy("Supplier", "आपूर्तिकर्ता")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">{copy("Name", "नाम")}<Input {...form.register("name")} /></label>
          <label className="grid gap-1 text-sm">{copy("Contact person", "संपर्क व्यक्ति")}<Input {...form.register("contactName")} /></label>
          <label className="grid gap-1 text-sm">{copy("Email", "ईमेल")}<Input type="email" {...form.register("email")} /></label>
          <label className="grid gap-1 text-sm">{copy("Phone", "फ़ोन")}<Input {...form.register("phone")} /></label>
          <label className="grid gap-1 text-sm">{copy("Mobile", "मोबाइल")}<Input {...form.register("mobile")} /></label>
          <label className="grid gap-1 text-sm">{copy("GSTIN", "जीएसटीआईएन")}<Input className="uppercase" {...form.register("gstin")} /></label>
          <label className="grid gap-1 text-sm">{copy("PAN", "पैन")}<Input className="uppercase" {...form.register("pan")} /></label>
          <label className="grid gap-1 text-sm">{copy("State", "राज्य")}<Input {...form.register("state")} /></label>
          <label className="grid gap-1 text-sm">{copy("State code", "राज्य कोड")}<Input inputMode="numeric" {...form.register("stateCode")} /></label>
          <label className="grid gap-1 text-sm">{copy("City", "शहर")}<Input {...form.register("city")} /></label>
          <label className="grid gap-1 text-sm">{copy("Postal code", "पिन कोड")}<Input {...form.register("postalCode")} /></label>
          <label className="grid gap-1 text-sm sm:col-span-2">{copy("Address line 1", "पता पंक्ति 1")}<Input {...form.register("addressLine1")} /></label>
          <label className="grid gap-1 text-sm">{copy("Credit period (days)", "उधार अवधि (दिन)")}<Input type="number" min={0} {...form.register("creditPeriodDays", { valueAsNumber: true })} /></label>
          <label className="grid gap-1 text-sm">{copy("Credit limit", "उधार सीमा")}<Input inputMode="decimal" {...form.register("creditLimit")} /></label>
          <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:col-span-2 lg:col-span-3">
            <legend className="px-1 text-sm font-medium">{copy("Opening balance", "प्रारंभिक शेष")}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">{copy("Amount", "राशि")}<Input inputMode="decimal" {...form.register("openingBalance.amount")} /></label>
              <label className="grid gap-1 text-sm">{copy("Balance side", "शेष पक्ष")}
                <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" {...form.register("openingBalance.side")}>
                  <option value="DEBIT">{copy("Debit", "नामे")}</option><option value="CREDIT">{copy("Credit", "जमा")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">{copy("Opening date", "प्रारंभ तिथि")}<Input type="date" {...form.register("openingBalance.date")} /></label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{copy("Bill-wise opening details (optional)", "बिल-वार प्रारंभिक विवरण (वैकल्पिक)")}</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => bills.append({ referenceNumber: "", dueDate: form.getValues("openingBalance.date") ?? "", amount: "0" })}>{copy("Add bill", "बिल जोड़ें")}</Button>
            </div>
            {bills.fields.map((field, index) => <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="grid gap-1 text-sm">{copy("Reference", "संदर्भ")}<Input {...form.register(`openingBalance.bills.${index}.referenceNumber`)} /></label>
              <label className="grid gap-1 text-sm">{copy("Due date", "देय तिथि")}<Input type="date" {...form.register(`openingBalance.bills.${index}.dueDate`)} /></label>
              <label className="grid gap-1 text-sm">{copy("Amount", "राशि")}<Input inputMode="decimal" {...form.register(`openingBalance.bills.${index}.amount`)} /></label>
              <Button className="self-end" type="button" size="sm" variant="secondary" onClick={() => bills.remove(index)}>{copy("Remove", "हटाएँ")}</Button>
            </div>)}
          </fieldset>
          {Object.values(form.formState.errors).map((error, index) => error && <p key={index} role="alert" className="text-sm text-red-700 sm:col-span-2 lg:col-span-3">{error.message ?? "Check the entered fields."}</p>)}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? copy("Saving…", "सहेजा जा रहा है…") : copy("Create party", "पार्टी बनाएँ")}</Button>
            {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
          </div>
        </form>
      </section>}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-52 flex-1 gap-1 text-sm">{copy("Search", "खोजें")}<Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={copy("Name, GSTIN, PAN, email or phone", "नाम, जीएसटीआईएन, पैन, ईमेल या फ़ोन")} /></label>
          <label className="grid gap-1 text-sm">{copy("Type", "प्रकार")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
              <option value="">{copy("All parties", "सभी पार्टियाँ")}</option><option value="CUSTOMER">{copy("Customers", "ग्राहक")}</option><option value="SUPPLIER">{copy("Suppliers", "आपूर्तिकर्ता")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">{copy("Status", "स्थिति")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">{copy("All", "सभी")}</option><option value="ACTIVE">{copy("Active", "सक्रिय")}</option><option value="INACTIVE">{copy("Inactive", "निष्क्रिय")}</option>
            </select>
          </label>
        </div>
        {query.isPending && <p role="status" className="py-8">{copy("Loading parties…", "पार्टियाँ लोड हो रही हैं…")}</p>}
        {query.isError && <p role="alert" className="py-8 text-red-700">{query.error.message}</p>}
        {query.data?.parties.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No parties found.", "कोई पार्टी नहीं मिली।")}</p>}
        {query.data && query.data.parties.length > 0 && <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-slate-500"><tr><th className="py-3">{copy("Name", "नाम")}</th><th>{copy("Type", "प्रकार")}</th><th>{copy("GSTIN / state", "जीएसटीआईएन / राज्य")}</th><th>{copy("Credit terms", "उधार शर्तें")}</th><th>{copy("Linked ledger", "संबंधित खाता")}</th><th>{copy("Status", "स्थिति")}</th></tr></thead>
            <tbody className="divide-y">{query.data.parties.map((party) => <tr key={party.id}>
              <td className="py-3 font-medium"><Link className="text-blue-700 hover:underline" href={`/dashboard/parties/${party.id}`}>{party.name}</Link></td>
              <td>{party.type === "CUSTOMER" ? copy("Customer", "ग्राहक") : copy("Supplier", "आपूर्तिकर्ता")}</td>
              <td>{party.gstin ?? "—"}{party.state ? <span className="block text-xs text-slate-500">{party.state}</span> : null}</td>
              <td>{party.creditPeriodDays} {copy("days", "दिन")} · {party.creditLimit}</td>
              <td>{party.ledger ? <Link className="text-blue-700 hover:underline" href={`/dashboard/ledgers/${party.ledger.id}`}>{party.ledger.name}</Link> : "—"}</td>
              <td>{party.isActive ? copy("Active", "सक्रिय") : copy("Inactive", "निष्क्रिय")}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {query.data && query.data.total > 20 && <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-slate-500">{copy("Page", "पृष्ठ")} {page} / {pageCount}</span>
          <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{copy("Previous", "पिछला")}</Button><Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>{copy("Next", "अगला")}</Button></div>
        </div>}
      </section>
    </div>
  );
}
