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
  { resource: "parties", action: "read", label: "View customers and suppliers" },
  { resource: "parties", action: "create", label: "Create customers and suppliers" },
  { resource: "parties", action: "update", label: "Update customers and suppliers" },
  { resource: "ledgers", action: "read", label: "View ledgers and accounting reports" },
  { resource: "ledgers", action: "create", label: "Create ledgers" },
  { resource: "ledgers", action: "update", label: "Update ledgers" },
  { resource: "ledger-groups", action: "read", label: "View ledger groups" },
  { resource: "ledger-groups", action: "manage", label: "Manage ledger groups" },
  { resource: "vouchers", action: "read", label: "View voucher history and trial balance" },
  { resource: "vouchers", action: "create", label: "Create voucher drafts" },
  { resource: "vouchers", action: "update", label: "Edit voucher drafts" },
  { resource: "vouchers", action: "post", label: "Post balanced vouchers" },
  { resource: "vouchers", action: "cancel", label: "Cancel voucher drafts" },
  { resource: "vouchers", action: "reverse", label: "Reverse posted vouchers" },
  { resource: "vouchers", action: "approve", label: "Approve or reject vouchers" },
  { resource: "voucher-series", action: "manage", label: "Manage voucher number series" },
  { resource: "cost-centres", action: "manage", label: "Manage cost centres" },
  { resource: "inventory", action: "read", label: "View stock items and inventory reports" },
  { resource: "inventory", action: "create", label: "Create stock items and opening stock" },
  { resource: "inventory", action: "update", label: "Update stock item settings" },
  { resource: "stock-groups", action: "read", label: "View stock groups" },
  { resource: "stock-groups", action: "manage", label: "Manage stock groups" },
  { resource: "units", action: "read", label: "View units and conversions" },
  { resource: "units", action: "manage", label: "Manage units and conversions" },
  { resource: "warehouses", action: "read", label: "View warehouses and godowns" },
  { resource: "warehouses", action: "manage", label: "Manage warehouses and godowns" },
  { resource: "inventory-movements", action: "read", label: "View inventory movement history" },
  { resource: "sales", action: "read", label: "View quotations and sales documents" },
  { resource: "sales", action: "create", label: "Create quotations and sales documents" },
  { resource: "sales", action: "update", label: "Update draft sales documents" },
  { resource: "sales", action: "issue", label: "Issue quotations and sales orders" },
  { resource: "sales", action: "post", label: "Post deliveries and sales invoices" },
  { resource: "sales", action: "cancel", label: "Cancel sales documents" },
  { resource: "sales", action: "send", label: "Send sales documents to customers" },
  { resource: "sales-reports", action: "read", label: "View sales registers and profitability reports" },
  { resource: "purchases", action: "read", label: "View purchase documents and supplier balances" },
  { resource: "purchases", action: "create", label: "Create purchase orders and invoices" },
  { resource: "purchases", action: "issue", label: "Issue purchase orders" },
  { resource: "purchases", action: "post", label: "Post receipts, purchase invoices and returns" },
  { resource: "purchases", action: "cancel", label: "Cancel or reverse purchase documents" },
  { resource: "purchase-reports", action: "read", label: "View purchase register and analysis" },
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
