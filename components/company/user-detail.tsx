"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { z } from "zod";
import { managementCopy } from "@/lib/management-copy";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    membership: z.object({
      id: z.string(),
      status: z.enum(["ACTIVE", "INVITED", "SUSPENDED"]),
      isDefault: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
      user: z.object({
        id: z.string(), name: z.string().nullable(), email: z.string(),
        mobile: z.string().nullable(), locale: z.enum(["EN", "HI", "BILINGUAL"]),
        createdAt: z.string(), emailVerifiedAt: z.string().nullable(),
      }),
      roles: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().nullable() })),
    }),
  }),
});

export function UserDetail({ membershipId, locale }: { membershipId: string; locale: Locale }) {
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const query = useQuery({
    queryKey: ["company-member", membershipId],
    queryFn: async () => {
      const response = await fetch(`/api/companies/members/${membershipId}`);
      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Could not load user details.");
      }
      return responseSchema.parse(await response.json()).data.membership;
    },
  });
  const dateLabel = (date: string) => new Intl.DateTimeFormat(locale === "HI" ? "hi-IN" : "en-IN", {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(date));

  if (query.isPending) return <p role="status">{copy("Loading user details…", "उपयोगकर्ता विवरण लोड हो रहा है…")}</p>;
  if (query.isError) return <p role="alert" className="text-red-700">{query.error.message}</p>;
  const membership = query.data;
  const details = [
    [copy("Email", "ईमेल"), membership.user.email],
    [copy("Mobile", "मोबाइल"), membership.user.mobile || copy("Not provided", "उपलब्ध नहीं")],
    [copy("User language", "उपयोगकर्ता भाषा"), membership.user.locale],
    [copy("Account created", "खाता बनाया गया"), dateLabel(membership.user.createdAt)],
    [copy("Email verification", "ईमेल सत्यापन"), membership.user.emailVerifiedAt ? copy("Verified", "सत्यापित") : copy("Not verified", "सत्यापित नहीं")],
    [copy("Company access status", "कंपनी पहुँच स्थिति"), membership.status],
    [copy("Member since", "सदस्यता शुरू"), dateLabel(membership.createdAt)],
    [copy("Last membership update", "अंतिम सदस्यता अपडेट"), dateLabel(membership.updatedAt)],
  ];
  return (
    <div className="space-y-5">
      <Link href="/dashboard/users" className="text-sm font-medium text-blue-700 hover:underline">← {copy("Back to users", "उपयोगकर्ताओं पर वापस जाएँ")}</Link>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{membership.user.name || membership.user.email}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd className="mt-1 break-words text-sm text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">{copy("Assigned user groups", "आवंटित उपयोगकर्ता समूह")}</h2>
        {membership.roles.length === 0
          ? <p className="mt-3 text-sm text-slate-500">{copy("No groups are assigned.", "कोई समूह आवंटित नहीं है।")}</p>
          : <ul className="mt-3 flex flex-wrap gap-2">{membership.roles.map((role) => (
            <li key={role.id} className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800" title={role.description ?? undefined}>{role.name}</li>
          ))}</ul>}
      </section>
    </div>
  );
}
