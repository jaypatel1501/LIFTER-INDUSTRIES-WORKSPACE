import type { Prisma } from "@prisma/client";

export const COMPANY_PERMISSION_CATALOG = [
  { resource: "company", action: "read", label: "View company settings" },
  { resource: "company", action: "update", label: "Edit company settings" },
  { resource: "members", action: "read", label: "View company users" },
  { resource: "members", action: "invite", label: "Invite company users" },
  { resource: "members", action: "update", label: "Activate, suspend and assign users" },
  { resource: "roles", action: "read", label: "View user groups and permissions" },
  { resource: "roles", action: "manage", label: "Manage user groups and permissions" },
  { resource: "sessions", action: "read", label: "View login and session history" },
  { resource: "sessions", action: "revoke", label: "Revoke company user sessions" },
  { resource: "audit", action: "read", label: "View audit trail" },
  { resource: "financial-years", action: "read", label: "View financial years" },
  { resource: "financial-years", action: "manage", label: "Create financial years" },
  { resource: "financial-years", action: "close", label: "Close financial years" },
  { resource: "profile", action: "manage", label: "Manage personal preferences" },
] as const;

export const OWNER_PERMISSIONS = COMPANY_PERMISSION_CATALOG.map(
  ({ resource, action }) => [resource, action] as const,
);

export async function grantPermissionsToRole(
  tx: Prisma.TransactionClient,
  roleId: string,
  permissions: readonly (readonly [string, string])[],
) {
  for (const [resource, action] of permissions) {
    const permission = await tx.permission.upsert({
      where: { resource_action: { resource, action } },
      create: { resource, action },
      update: {},
    });
    await tx.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      create: { roleId, permissionId: permission.id },
      update: {},
    });
  }
}

export const COMPANY_PERMISSION_KEYS = new Set(
  COMPANY_PERMISSION_CATALOG.map(({ resource, action }) => `${resource}:${action}`),
);
