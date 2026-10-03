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
import { roleSchema } from "@/lib/validation/companies";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    roles: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      isSystem: z.boolean(),
      _count: z.object({ memberships: z.number() }),
      permissionKeys: z.array(z.string()),
    })),
    permissionCatalog: z.array(z.object({
      resource: z.string(), action: z.string(), label: z.string(),
    })),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
type Values = z.input<typeof roleSchema>;
type Role = z.infer<typeof responseSchema>["data"]["roles"][number];

const hindiPermissionLabels: Record<string, string> = {
  "company:read": "कंपनी सेटिंग देखें",
  "company:update": "कंपनी सेटिंग संपादित करें",
  "members:read": "कंपनी उपयोगकर्ता देखें",
  "members:invite": "उपयोगकर्ताओं को आमंत्रित करें",
  "members:update": "उपयोगकर्ता पहुँच प्रबंधित करें",
  "roles:read": "समूह और अनुमतियाँ देखें",
  "roles:manage": "समूह और अनुमतियाँ प्रबंधित करें",
  "sessions:read": "लॉगिन और सत्र इतिहास देखें",
  "sessions:revoke": "उपयोगकर्ता सत्र रद्द करें",
  "audit:read": "ऑडिट ट्रेल देखें",
  "financial-years:read": "वित्तीय वर्ष देखें",
  "financial-years:manage": "वित्तीय वर्ष बनाएँ",
  "financial-years:close": "वित्तीय वर्ष बंद करें",
  "profile:manage": "व्यक्तिगत प्राथमिकताएँ प्रबंधित करें",
};

export function RolesManager({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSystem, setEditingSystem] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedPermissionKeys, setSelectedPermissionKeys] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["company-roles", search, type, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (search) params.set("search", search);
      if (type) params.set("type", type);
      const response = await fetch(`/api/companies/roles?${params}`);
      if (!response.ok) throw new Error("Could not load groups and permissions.");
      return responseSchema.parse(await response.json()).data;
    },
  });
  const form = useForm<Values>({
    resolver: zodResolver(roleSchema),
    defaultValues: { name: "", description: "", permissions: [] },
  });
  const mutation = useMutation({
    mutationFn: async (values: Values) => {
      const response = await fetch(editingId ? `/api/companies/roles/${editingId}` : "/api/companies/roles", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save group.");
    },
    onSuccess: async () => {
      setMessage(managementCopy(locale, "Group saved.", "समूह सहेजा गया।"));
      setEditingId(null);
      setEditingSystem(false);
      setSelectedPermissionKeys([]);
      form.reset({ name: "", description: "", permissions: [] });
      await queryClient.invalidateQueries({ queryKey: ["company-roles"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const response = await fetch(`/api/companies/roles/${roleId}`, { method: "DELETE" });
      const body = await response.json() as { success: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not delete group.");
    },
    onSuccess: async () => {
      setMessage(managementCopy(locale, "Group deleted.", "समूह हटाया गया।"));
      setEditingId(null);
      setEditingSystem(false);
      setSelectedPermissionKeys([]);
      form.reset({ name: "", description: "", permissions: [] });
      await queryClient.invalidateQueries({ queryKey: ["company-roles"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const copy = (en: string, hi: string) => managementCopy(locale, en, hi);
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));

  function selectRole(role: Role) {
    setEditingId(role.id);
    setEditingSystem(role.isSystem);
    setMessage("");
    setSelectedPermissionKeys(role.permissionKeys);
    form.reset({
      name: role.name,
      description: role.description ?? "",
      permissions: role.permissionKeys,
    });
  }

  function togglePermission(key: string, checked: boolean) {
    const selected = new Set(selectedPermissionKeys);
    if (checked) selected.add(key);
    else selected.delete(key);
    const updated = [...selected];
    setSelectedPermissionKeys(updated);
    form.setValue("permissions", updated, { shouldDirty: true, shouldValidate: true });
  }

  if (query.isPending) return <p role="status">{copy("Loading groups…", "समूह लोड हो रहे हैं…")}</p>;
  if (query.isError) return <p role="alert" className="text-red-700">{query.error.message}</p>;

  const groupedPermissions = query.data.permissionCatalog.reduce<
    Record<string, typeof query.data.permissionCatalog>
  >((groups, permission) => {
    (groups[permission.resource] ??= []).push(permission);
    return groups;
  }, {});
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{copy("User groups", "उपयोगकर्ता समूह")}</h2>
          {canManage && <Button variant="secondary" size="sm" onClick={() => {
            setEditingId(null);
            setEditingSystem(false);
            setMessage("");
            setSelectedPermissionKeys([]);
            form.reset({ name: "", description: "", permissions: [] });
          }}>{copy("New group", "नया समूह")}</Button>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">{copy("Search groups", "समूह खोजें")}
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
          </label>
          <label className="grid gap-1 text-sm">{copy("Group type", "समूह प्रकार")}
            <select className="h-11 rounded-lg border border-slate-300 bg-white px-3" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
              <option value="">{copy("All groups", "सभी समूह")}</option>
              <option value="system">{copy("System", "सिस्टम")}</option>
              <option value="custom">{copy("Custom", "कस्टम")}</option>
            </select>
          </label>
        </div>
        <div className="mt-4 divide-y divide-slate-100">
          {query.data.roles.map((role) => (
            <article key={role.id} className="flex items-start justify-between gap-3 py-4">
              <button type="button" className="min-w-0 text-left" onClick={() => selectRole(role)}>
                <span className="block font-semibold text-slate-900">{role.name}</span>
                <span className="mt-1 block text-xs text-slate-600">{role.description || copy("No description", "विवरण उपलब्ध नहीं")}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {role._count.memberships} {copy("assigned users", "आवंटित उपयोगकर्ता")}
                  {role.isSystem ? ` · ${copy("system group", "सिस्टम समूह")}` : ""}
                </span>
              </button>
              {canManage && !role.isSystem && (
                <Button variant="destructive" size="sm" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(role.id)}>
                  {copy("Delete", "हटाएँ")}
                </Button>
              )}
            </article>
          ))}
        </div>
        {query.data.roles.length === 0 && <p className="py-6 text-sm text-slate-500">{copy("No groups match these filters.", "इन फ़िल्टर से कोई समूह नहीं मिला।")}</p>}
        {query.data.total > 25 && (
          <div className="mt-4 flex items-center justify-between">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{copy("Previous", "पिछला")}</Button>
            <span className="text-sm text-slate-600">{copy("Page", "पृष्ठ")} {page} / {pageCount}</span>
            <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>{copy("Next", "अगला")}</Button>
          </div>
        )}
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">{editingId ? copy("Edit group permissions", "समूह अनुमतियाँ संपादित करें") : copy("Create a user group", "उपयोगकर्ता समूह बनाएँ")}</h2>
        {!canManage && (
          <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{copy("You have read-only group access.", "आपके पास केवल-पढ़ने की समूह पहुँच है।")}</p>
        )}
        {editingSystem && (
          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{copy("System groups are read-only. Create a custom group to change access.", "सिस्टम समूह केवल पढ़ने के लिए हैं। पहुँच बदलने के लिए नया समूह बनाएँ।")}</p>
        )}
        <form className="mt-4 space-y-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <label className="grid gap-1.5 text-sm">{copy("Group name", "समूह का नाम")}<Input {...form.register("name")} disabled={!canManage || editingSystem} /></label>
          {form.formState.errors.name?.message && <p role="alert" className="text-sm text-red-700">{form.formState.errors.name.message}</p>}
          <label className="grid gap-1.5 text-sm">{copy("Description", "विवरण")}<Input {...form.register("description")} disabled={!canManage || editingSystem} /></label>
          <fieldset disabled={!canManage || editingSystem} className="space-y-4">
            <legend className="font-medium">{copy("Action-level permissions", "कार्रवाई-स्तरीय अनुमतियाँ")}</legend>
            {Object.entries(groupedPermissions).map(([resource, permissions]) => (
              <fieldset key={resource} className="rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold capitalize">{resource}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {permissions.map(({ action, label }) => {
                    const key = `${resource}:${action}`;
                    const selected = selectedPermissionKeys.includes(key);
                    return (
                      <label key={key} className="flex items-start gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={selected} onChange={(event) => togglePermission(key, event.target.checked)} className="mt-1 accent-blue-700" />
                        <span>{locale === "EN" ? label : locale === "HI" ? (hindiPermissionLabels[key] ?? label) : `${label} · ${hindiPermissionLabels[key] ?? label}`}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            {canManage &&             <Button type="submit" disabled={mutation.isPending || editingSystem}>
              {mutation.isPending ? copy("Saving…", "सहेजा जा रहा है…") : copy("Save group", "समूह सहेजें")}
            </Button>}
            {editingId && <Button type="button" variant="secondary" onClick={() => {
              setEditingId(null);
              setEditingSystem(false);
              setSelectedPermissionKeys([]);
              form.reset({ name: "", description: "", permissions: [] });
            }}>{copy("Cancel", "रद्द करें")}</Button>}
          </div>
        </form>
      </section>
      {message && <p role="status" className="text-sm text-slate-700 xl:col-span-2">{message}</p>}
    </div>
  );
}
