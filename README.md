# ERP System

Enterprise-oriented Indian business ERP foundation built on Next.js App Router, strict TypeScript, PostgreSQL/Neon and Prisma. The platform includes company administration, accounting and inventory masters, a shared auditable voucher lifecycle, and quotation-to-sales-order, delivery-note and GST sales-invoice workflows.

## Foundation

- Auth.js JWT sessions with bcrypt-backed email/password sign-in, mobile OTP adapter, account lockout, password reset, and session revocation after password reset.
- Existing SMTP email service for registration verification, verification resend, password reset and company invitations; configure `EMAIL_SERVER` and `EMAIL_FROM` in Vercel Production.
- Company-scoped membership, company roles, global permission catalog and reusable RBAC/tenant guards.
- Company profile administration (GSTIN/PAN, registered address and contacts, GST state, financial-year settings and private object-storage logo), annual books periods, user invitations and membership activation/suspension.
- Tenant-scoped customer/supplier masters with GSTIN/PAN, addresses, contact and credit terms; linked party ledgers and bill-wise opening balances posted through immutable, idempotent double-entry vouchers.
- Standard company-specific ledger-group hierarchy, cash/bank/tax/income/expense/general ledgers, cost-centre and interest flags, transaction history, customer/supplier summaries, and a posted-voucher trial balance.
- Tenant-scoped stock groups, units/conversions, HSN/SAC and GST/rate/barcode item masters, warehouse/location trees, batch/expiry tracking, opening-stock vouchers, idempotent inventory movements, warehouse/batch balances, reorder summaries and batch-expiry reports.
- Central company-scoped voucher numbering and financial-year checks, balanced double-entry lines, idempotent posting/cancellation/reversal, approval history, bill-wise/tax/cost-centre details, atomic ledger and stock postings, Day Book events, private voucher attachments, voucher filters and number-series management.
- Quotation acceptance and conversion to sales orders, partial delivery/invoicing checks, cash/credit invoices, CGST/SGST/UTGST/IGST calculation, batch/godown stock issue, output-tax and receivable postings, customer credit-limit checks, sales register/profitability reports, bilingual print-ready invoices, SMTP and WhatsApp adapters.
- Purchase orders, receipt notes and supplier invoices with partial order fulfillment, supplier invoice references, cash/credit settlement, batch/expiry and godown receipts, proportional freight capitalization, input GST, supplier payables/bill-wise references, purchase returns and purchase register/analysis.
- Instrumented payment/receipt/contra vouchers, bank/cash transfers, partial multi-bill settlements and advances, customer/supplier credit/debit notes, sales returns, open-outstanding reports, print-ready vouchers and filtered CSV export.
- Action-level role/group matrix, user detail views, scoped failed-login/session history with revocation, searchable audit trail, and English/Hindi/bilingual management screens.
- PostgreSQL schema, foreign keys, constraints, indexes, migrations, Prisma singleton and transaction helper.
- Audited company creation and authentication events, database-backed rate limits, and idempotency-key hashing.
- Protected company dashboard shell, company onboarding/switching, persisted English/Hindi/bilingual preferences.
- Liveness/readiness routes and private Vercel Blob upload helper; user files are not written to local disk.
- Docker Compose PostgreSQL for local development, CI quality gates, Jest unit/integration coverage and Playwright smoke coverage.

## Local quick start

Requirements: Node.js 22 (Next.js 16 requires Node.js 20.9 or newer), npm, and Docker Desktop or PostgreSQL 17.

1. Start PostgreSQL: `docker compose up -d postgres`.
2. Create `.env` from the variable names in `.env.example` and set local PostgreSQL URLs, a random `AUTH_SECRET` of at least 32 characters, `AUTH_URL` and `NEXT_PUBLIC_APP_URL`.
3. Set development-only `SEED_ADMIN_EMAIL` and a strong `SEED_ADMIN_PASSWORD` in `.env`.
4. Run `npm install`, `npm run prisma:generate`, `npm run db:migrate`, `npm run db:seed`, then `npm run dev`.
5. Sign in using the development administrator credentials configured locally.

The seed refuses to run with `NODE_ENV=production`. `.env.example` contains variable names only; do not commit local environment files or credentials.

See [local development](./docs/local-development.md), [database migrations](./docs/database-migrations.md), [Vercel deployment](./docs/vercel-deployment.md), the [foundation API reference](./docs/api-foundation.md), the [voucher API and posting guide](./docs/api-vouchers.md), the [sales workflow API guide](./docs/api-sales.md), and the [purchase workflow API guide](./docs/api-purchases.md).

## Quality checks

```sh
npm run prisma:generate
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

## Health probes

- `GET /api/health` is a database-independent liveness probe.
- `GET /api/readiness` executes a database query and returns a failure response if PostgreSQL is unavailable.

## Security boundaries

Every company-owned query must use a verified active membership and include its `companyId`. Enforce action-level access with `requirePermission`; opening-balance and opening-stock posting use serializable Prisma transactions, idempotency keys, audit events and immutable posted vouchers/movements. Future financial posting modules must extend the same voucher, ledger-line and inventory-movement foundations and update their related records atomically. Credentials and integration tokens are server-only environment variables. Production secrets belong in Vercel Project Settings.
