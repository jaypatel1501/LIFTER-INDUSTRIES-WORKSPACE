# Foundation API reference

All APIs use Next.js App Router Route Handlers. JSON responses use `{ success, data, error }`; request bodies and query strings are validated with Zod. Protected endpoints use Auth.js JWT sessions and return standard 401/403 errors.

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Liveness probe; independent of PostgreSQL. |
| `GET` | `/api/readiness` | Public | Database readiness probe. |
| `POST` | `/api/auth/otp` | Public, rate limited | Request a mobile OTP; response avoids account enumeration. |
| `POST` | `/api/auth/password-reset` | Public, rate limited | Request an email reset link; response avoids account enumeration. |
| `PUT` | `/api/auth/password-reset` | Public, rate limited | Atomically consume a one-use reset token, update the password and revoke JWT sessions. |
| `PUT` | `/api/auth/password-change` | Authenticated, rate limited | Verify the current password, replace it and revoke all sessions atomically. |
| `GET` | `/api/companies` | Authenticated | List active company memberships for the current user. |
| `POST` | `/api/companies` | Authenticated, rate limited | Create a company, owner role, base permissions, membership and audit event atomically. |
| `POST` | `/api/companies/active` | Authenticated, rate limited | Verify membership before the Auth.js session update. The JWT callback rechecks and audits accepted switches. |
| `GET`, `PATCH` | `/api/companies/current` | `company:read`, `company:update` | Read or update active-company legal/tax/address/contact, currency/time-zone and books-start settings. |
| `GET`, `POST` | `/api/companies/current/logo` | `company:read`, `company:update` | Stream or upload a validated private PNG/JPEG/WebP logo through Vercel Blob. Uploads are limited to 2 MB. |
| `GET`, `POST` | `/api/companies/financial-years` | `financial-years:read`, `financial-years:manage` | List and create company-scoped accounting periods; rejects overlapping periods. |
| `PATCH` | `/api/companies/financial-years/{financialYearId}` | `financial-years:close` | Close an open financial year; closed periods cannot be reopened. |
| `GET`, `POST` | `/api/companies/members` | `members:read`, `members:invite` | Search, filter and paginate users; invite an email address to the active company. |
| `GET`, `PATCH` | `/api/companies/members/{membershipId}` | `members:read`, `members:update`, `roles:manage` | Read tenant-scoped member details, activate/suspend membership, or assign company groups. |
| `POST` | `/api/companies/members/{membershipId}/invitation` | `members:invite` | Re-send a pending invitation using a short-lived password-setup link when needed. |
| `GET`, `POST` | `/api/companies/roles` | `roles:read`, `roles:manage` | Search, filter and paginate company groups; create a group with action-level permissions. |
| `PUT`, `DELETE` | `/api/companies/roles/{roleId}` | `roles:manage` | Update a custom permission matrix or remove an unassigned custom group. System groups are immutable. |
| `GET` | `/api/companies/security/history` | `sessions:read` | Filter and paginate known company members' login attempts and device sessions. |
| `DELETE` | `/api/companies/security/sessions/{sessionId}` | `sessions:revoke` | Revoke a session belonging to a user associated with the active company. |
| `GET` | `/api/audit?page=1&pageSize=25&search=...&action=...` | `audit:read` permission | Filter and paginate audit events scoped to the active company. Cursor pagination remains supported. |
| `GET`, `POST` | `/api/accounting/parties` | `parties:read`, `parties:create` | Search, filter and paginate customers/suppliers; creation atomically creates a linked ledger and optional opening voucher with bill-wise details. POST requires `Idempotency-Key`. |
| `GET`, `PATCH` | `/api/accounting/parties/{partyId}` | `parties:read`, `parties:update` | Read or update company-scoped party tax/contact/address/credit/status details and recent posted voucher history. Opening balances are immutable after posting. |
| `GET`, `POST` | `/api/accounting/ledgers` | `ledgers:read`, `ledgers:create` | Search and paginate ledgers; create general, cash, bank, tax, income or expense accounts with cost-centre/interest flags and optional opening voucher. POST requires `Idempotency-Key`. |
| `PATCH` | `/api/accounting/ledgers/{ledgerId}` | `ledgers:update` | Update non-system, non-party ledger settings. Posted balances cannot be edited. |
| `GET` | `/api/accounting/ledgers/{ledgerId}/transactions` | `vouchers:read` | Paginated posted voucher history with date/search filters and bill-wise references. |
| `GET`, `POST` | `/api/accounting/groups` | `ledger-groups:read`, `ledger-groups:manage` | Read the standard account hierarchy or create a custom account group. |
| `PATCH`, `DELETE` | `/api/accounting/groups/{groupId}` | `ledger-groups:manage` | Edit/delete custom groups; system groups, used groups, and parent groups with children are protected. |
| `GET` | `/api/accounting/reports/trial-balance` | `vouchers:read` | Paginated debit/credit trial balance derived from posted voucher lines with optional as-of date, group and search filters. |
| `GET` | `/api/accounting/reports/parties?type=CUSTOMER&page=1&pageSize=50` | `parties:read` | Paginated customer or supplier summary with current/as-of receivable and payable balances and credit terms. |
| `GET`, `POST` | `/api/inventory/groups` | `stock-groups:read`, `stock-groups:manage` | Searchable company stock-group hierarchy; manage creates groups. Standard groups cannot be changed or removed. |
| `PATCH`, `DELETE` | `/api/inventory/groups/{groupId}` | `stock-groups:manage` | Update or remove custom groups; groups with items/children are protected. |
| `GET`, `POST` | `/api/inventory/units` | `units:read`, `units:manage` | List/create company units of measure with supported decimal precision and item-usage counts. |
| `POST` | `/api/inventory/units/conversions` | `units:manage` | Create a positive, explicit generic conversion factor between two company units. |
| `GET`, `POST` | `/api/inventory/warehouses` | `warehouses:read`, `warehouses:manage` | List/create company-scoped godowns and nested locations. |
| `PATCH`, `DELETE` | `/api/inventory/warehouses/{warehouseId}` | `warehouses:manage` | Update hierarchy/address/active status or delete an unused custom location. |
| `GET`, `POST` | `/api/inventory/items?page=1&pageSize=25&search=...&groupId=...&status=ACTIVE` | `inventory:read`, `inventory:create` | Search and paginate stock masters with HSN/GST, rates, alternate units, barcodes and balances. POST requires `Idempotency-Key`; optional opening movements and their balanced accounting voucher are atomic. |
| `GET`, `PATCH` | `/api/inventory/items/{itemId}` | `inventory:read`, `inventory:update` | Read item alternate-unit, batch, location-balance details or update tax/rate/stock-level/active settings. |
| `GET` | `/api/inventory/movements?itemId=...&page=1&pageSize=25` | `inventory-movements:read` | Read-only, company-scoped movement history with optional item, warehouse, batch, type and date filters. Future posting workflows use the transaction-scoped idempotent movement service. |
| `GET` | `/api/inventory/reports/stock-summary?search=...&lowStock=true` | `inventory:read` | Paginated stock quantities/valuation and reorder-alert summary. |
| `GET` | `/api/inventory/reports/batch-expiry?before=YYYY-MM-DD&page=1&pageSize=25` | `inventory:read` | Paginated positive batch balances, manufacturing/expiry dates, godown, quantity and value. |
| `PATCH` | `/api/profile/locale` | Authenticated | Persist English, Hindi or bilingual preference. |
| `GET`, `POST` | `/api/auth/[...nextauth]` | Auth.js | Auth.js sign-in, session and sign-out handlers. |

Company switching uses a short-lived server-signed proof returned only after membership verification. The Auth.js JWT callback verifies the proof and membership, applies a session-scoped rate limit and writes an IP/user-agent audit record before changing the active company claim; dashboard queries also re-check membership.

All management handlers verify the active membership and resource/action permission before querying or writing company records. Role and membership mutations, financial-year changes, company settings, session revocations, accounting master changes, and their audit events use Prisma transactions. Deactivating a membership revokes the affected user's active sessions and advances the global session version. The company must retain at least one active Owner.

Opening entries require an `Idempotency-Key`, use the company's books-beginning date (or the configured financial year's books-beginning date), and are posted in one serializable transaction. Each voucher has equal debit and credit lines; party bill-wise opening details must sum exactly to the party ledger line. An Opening Balance Difference ledger offsets opening balances. Vouchers are not editable after posting; reports and histories read only posted voucher lines.

Invitations require `EMAIL_SERVER`, `EMAIL_FROM`, and a canonical `AUTH_URL` or `NEXT_PUBLIC_APP_URL`. A newly invited account receives a one-time 30-minute password-setup link; existing accounts receive a sign-in link. A delivery failure is returned explicitly, leaves the invitation pending, and can be retried from the user list. Company logos use private Vercel Blob storage and are served only through the authenticated company-scoped logo route.

Sales/purchase voucher posting, payment, receipt, contra, journal, GST filing, payroll and other business-module posting APIs are not included yet. Inventory master creation can post opening stock, but there are no purchase/sales/adjustment/transfer posting screens yet. Future posting handlers must extend the voucher/ledger and inventory-movement foundations and require an `Idempotency-Key`, RBAC and company checks, one serializable Prisma transaction, immutable posted-document state, and audit records for the document and all related ledger, stock, tax and outstanding updates.
