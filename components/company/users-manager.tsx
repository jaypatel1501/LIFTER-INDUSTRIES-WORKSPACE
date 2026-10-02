"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@prisma/client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { managementCopy } from "@/lib/management-copy";
import { memberInviteSchema } from "@/lib/validation/companies";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    members: z.array(z.object({
      id: z.string(),
      status: z.enum(["ACTIVE", "INVITED", "SUSPENDED"]),
      createdAt: z.string(),
      user: z.object({ id: z.string(), name: z.string().nullable(), email: z.string(), mobile: z.string().nullable() }),
      roles: z.array(z.object({ id: z.string(), name: z.string() })),
    })),
    roles: z.array(z.object({ id: z.string(), name: z.string() })),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});

type InviteInput = z.input<typeof memberInviteSchema>;
type Member = z.infer<typeof responseSchema>["data"]["members"][number];

export function UsersManager({
  locale, canManageRoles, canInvite, canUpdate,
}: { locale: Locale; canManageRoles: boolean; canInvite: boolean; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [roleId, setRoleId] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["company-members", search, status, roleId, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (roleId) params.set("roleId", roleId);
      const response = await fetch(`/api/companies/members?${params}`);
      if (!response.ok) throw new Error("Could not load company users.");
      return responseSchema.parse(await response.json()).data;
    },
  });
  const inviteForm = useForm<InviteInput>({
    resolver: zodResolver(memberInviteSchema),
    defaultValues: { email: "", name: "", mobile: "", roleIds: [] },
  });
  const inviteMutation = useMutation({
    mutationFn: async (values: InviteInput) => {
      const response = await fetch("/api/companies/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          name: values.name,
          mobile: values.mobile || undefined,
          ...(values.roleIds?.filter(Boolean).length
            ? { roleIds: values.roleIds.filter(Boolean) }
            : {}),
        }),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Invitation failed.");
    },
    onSuccess: async () => {
      inviteForm.reset();
      setMessage(managementCopy(locale, "Invitation sent.", "आमंत्रण भेजा गया।"));
      await queryClient.invalidateQueries({ queryKey: ["company-members"] });
    },
    onError: async (error) => {
      setMessage(error.message);
      await queryClient.invalidateQueries({ queryKey: ["company-members"] });
    },
  });
  const memberMutation = useMutation({
    mutationFn: async ({ member, status: nextStatus, roleIds }: {
      member: Member;
      status?: "ACTIVE" | "SUSPENDED";
      roleIds?: string[];
    }) => {
      const response = await fetch(`/api/companies/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(roleIds !== undefined ? { roleIds } : {}),
        }),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not update user.");
    },
    onSuccess: async () => {
      setMessage(managementCopy(locale, "User updated.", "उपयोगकर्ता अपडेट हुआ।"));
      await queryClient.invalidateQueries({ queryKey: ["company-members"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const resendMutation = useMutation({
    mutationFn: async (member: Member) => {
      const response = await fetch(`/api/companies/members/${member.id}/invitation`, { method: "POST" });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not resend invitation.");
    },
    onSuccess: () => setMessage(managementCopy(locale, "Invitation resent.", "आमंत्रण फिर से भेजा गया।")),
    onError: (error) => setMessage(error.message),
  });
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);

  return (
    <div className="space-y-6">
      {canInvite && <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{copy("Invite a user", "उपयोगकर्ता को आमंत्रित करें")}</h2>
        <p className="mt-1 text-sm text-slate-600">{copy("Invitations use email to set up secure access.", "सुरक्षित पहुँच के लिए ईमेल आमंत्रण भेजा जाता है।")}</p>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={inviteForm.handleSubmit((values) => inviteMutation.mutate(values))}
        >
          <label className="grid gap-1 text-sm">{copy("Name", "नाम")}<Input autoComplete="name" {...inviteForm.register("name")} /></label>
          <label className="grid gap-1 text-sm">{copy("Email", "ईमेल")}<Input type="email" autoComplete="email" {...inviteForm.register("email")} /></label>
          <label className="grid gap-1 text-sm">{copy("Mobile (international format)", "मोबाइल (अंतरराष्ट्रीय प्रारूप)")}<Input type="tel" placeholder="+919876543210" {...inviteForm.register("mobile")} /></label>
          {canManageRoles && <label className="grid gap-1 text-sm">
            {copy("Initial user group", "प्रारंभिक उपयोगकर्ता समूह")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm" {...inviteForm.register("roleIds.0")}>
              <option value="">{copy("Default member group", "डिफ़ॉल्ट सदस्य समूह")}</option>
              {query.data?.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>}
          {(["name", "email", "mobile"] as const).map((field) => inviteForm.formState.errors[field]?.message && (
            <p key={field} role="alert" className="text-sm text-red-700">{inviteForm.formState.errors[field]?.message}</p>
          ))}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? copy("Sending…", "भेजा जा रहा है…") : copy("Send invitation", "आमंत्रण भेजें")}
            </Button>
          </div>
        </form>
      </section>}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{copy("Company users", "कंपनी उपयोगकर्ता")}</h2>
            <p className="mt-1 text-sm text-slate-600">{copy("Search, filter, change groups, and activate or suspend access.", "खोजें, फ़िल्टर करें, समूह बदलें और पहुँच सक्रिय या निलंबित करें।")}</p>
          </div>
          <p className="text-sm text-slate-500">{query.data?.total ?? 0} {copy("users", "उपयोगकर्ता")}</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-sm">{copy("Search by name, email or mobile", "नाम, ईमेल या मोबाइल से खोजें")}
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </label>
          <label className="grid gap-1 text-sm">{copy("User group", "उपयोगकर्ता समूह")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm" value={roleId} onChange={(event) => { setRoleId(event.target.value); setPage(1); }}>
              <option value="">{copy("All groups", "सभी समूह")}</option>
              {query.data?.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">{copy("Membership status", "सदस्यता स्थिति")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">{copy("All statuses", "सभी स्थितियाँ")}</option>
              <option value="ACTIVE">{copy("Active", "सक्रिय")}</option>
              <option value="INVITED">{copy("Invited", "आमंत्रित")}</option>
              <option value="SUSPENDED">{copy("Suspended", "निलंबित")}</option>
            </select>
          </label>
        </div>
        {query.isPending && <p role="status" className="py-8 text-sm text-slate-500">{copy("Loading users…", "उपयोगकर्ता लोड हो रहे हैं…")}</p>}
        {query.isError && <p role="alert" className="py-8 text-sm text-red-700">{query.error.message}</p>}
        {query.data && query.data.members.length === 0 && <p className="py-8 text-sm text-slate-500">{copy("No users match these filters.", "इन फ़िल्टर से कोई उपयोगकर्ता नहीं मिला।")}</p>}
        {query.data && query.data.members.length > 0 && (
          <div className="mt-4 divide-y divide-slate-100">
            {query.data.members.map((member) => (
              <MemberRow
                key={`${member.id}-${member.roles.map(({ id }) => id).sort().join("-")}`}
                member={member}
                roles={canManageRoles ? query.data.roles : []}
                locale={locale}
                disabled={memberMutation.isPending}
                onSaveRoles={(roleIds) => memberMutation.mutate({ member, roleIds })}
                onStatus={(nextStatus) => memberMutation.mutate({ member, status: nextStatus })}
                canManageRoles={canManageRoles}
                onResend={() => resendMutation.mutate(member)}
                resendDisabled={resendMutation.isPending}
                canInvite={canInvite}
                canUpdate={canUpdate}
              />
            ))}
          </div>
        )}
        {query.data && query.data.total > 20 && (
          <div className="mt-4 flex items-center justify-between">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button>
            <span className="text-sm text-slate-600">{copy("Page", "पृष्ठ")} {page} / {Math.ceil(query.data.total / 20)}</span>
            <Button variant="secondary" disabled={page >= Math.ceil(query.data.total / 20)} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button>
          </div>
        )}
      </section>
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
    </div>
  );
}

function MemberRow({
  member, roles, locale, disabled, onSaveRoles, onStatus, canManageRoles, onResend, resendDisabled, canInvite, canUpdate,
}: {
  member: Member;
  roles: Array<{ id: string; name: string }>;
  locale: Locale;
  disabled: boolean;
  onSaveRoles: (roleIds: string[]) => void;
  onStatus: (status: "ACTIVE" | "SUSPENDED") => void;
  canManageRoles: boolean;
  onResend: () => void;
  resendDisabled: boolean;
  canInvite: boolean;
  canUpdate: boolean;
}) {
  const [roleIds, setRoleIds] = useState(member.roles.map(({ id }) => id));
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  return (
    <article className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-center">
      <div className="min-w-0">
        <Link href={`/dashboard/users/${member.id}`} className="truncate font-semibold text-blue-800 hover:underline">{member.user.name || member.user.email}</Link>
        <p className="truncate text-sm text-slate-600">{member.user.email}{member.user.mobile ? ` · ${member.user.mobile}` : ""}</p>
        <p className="mt-1 text-xs text-slate-500">{member.status === "ACTIVE" ? copy("Active", "सक्रिय") : member.status === "INVITED" ? copy("Invited", "आमंत्रित") : copy("Suspended", "निलंबित")}</p>
      </div>
      {canManageRoles && <label className="grid gap-1 text-xs font-medium text-slate-600">
        {copy("Groups", "समूह")}
        <select
          multiple
          size={Math.min(Math.max(roles.length, 2), 4)}
          className="rounded-lg border border-slate-300 bg-white p-2 text-sm"
          value={roleIds}
          onChange={(event) => setRoleIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
        >
          {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select>
      </label>
      }
      <div className="flex flex-wrap gap-2">
        {canManageRoles && <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onSaveRoles(roleIds)}>{copy("Save groups", "समूह सहेजें")}</Button>}
        {member.status === "INVITED" && canInvite && <Button variant="secondary" size="sm" disabled={resendDisabled} onClick={onResend}>{copy("Resend invite", "आमंत्रण फिर से भेजें")}</Button>}
        {canUpdate && (member.status === "ACTIVE"
          ? <Button variant="destructive" size="sm" disabled={disabled} onClick={() => onStatus("SUSPENDED")}>{copy("Suspend", "निलंबित करें")}</Button>
          : <Button size="sm" disabled={disabled} onClick={() => onStatus("ACTIVE")}>{copy("Activate", "सक्रिय करें")}</Button>)}
      </div>
    </article>
  );
}
