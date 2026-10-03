# Database and migrations

## Schema

`prisma/schema.prisma` uses PostgreSQL and defines users, companies, memberships, company roles, global permissions, role and membership joins, audit events, password reset tokens, OTP challenges, login history, auth sessions, rate limits, and company financial years. Accounting adds tenant-owned parties, ledger groups, ledgers, posted double-entry vouchers, voucher lines and bill-wise opening details. Company configuration covers Indian tax identifiers, registered address/contact details, logo object URL, time zone/currency, books-beginning date, and financial-year start month.

Company-owned records include a `companyId` foreign key, an index, and tenant-aware uniqueness where applicable. Membership and permission joins have composite primary keys. Foreign keys specify deletion behavior; audit entries restrict company deletion and retain actor history when a user is deleted.

The company-management migration adds the financial-year table and its company foreign key, date-range and company/start-date constraints, PAN/GSTIN/state-code checks, and indexes for PAN, GST state and financial-year filtering. It also backfills the company-management action catalog, grants existing system Owners the new management actions, and creates a standard Member group for existing companies. The accounting migration adds composite company-aware foreign keys, tax and balance checks, idempotency uniqueness, party and voucher indexes, accounting permissions for existing Owners, and standard account-group trees plus an opening-balance offset ledger for every existing company.

New companies receive the same standard account-group tree and opening-balance offset ledger in the company-creation transaction. Opening-balance vouchers and their bill details are created atomically with the party/ledger master; posted voucher lines are the source for ledger history and trial-balance reports.

The inventory migration adds company-scoped stock groups, units and conversions, items, warehouse trees, batches, per-location/batch balances and immutable stock movements. It adds composite company-aware foreign keys, decimal/date/stock-level checks, idempotency and lookup indexes, and the inventory permission catalog. Existing companies receive standard stock groups, common units and conversions, a main godown, and a Stock on Hand ledger. New company creation and development seeding provision the same defaults. Opening stock is posted as audited inventory movements and a balanced opening voucher in the same serializable transaction; use the shared movement service for future purchase, sales, transfer and production integrations.

The voucher-platform migration extends the existing voucher lifecycle with drafts and reversal status, financial-year/number-series references, approval state, post/cancel idempotency keys, and reversal links. It adds ledger/tax transactions, bill-wise entries, cost centres/allocations, inventory detail metadata, private attachment metadata, approval actions, immutable voucher audit events and Day Book source events. It backfills ledger-transaction and Day Book rows for existing posted vouchers and grants the new voucher, series and cost-centre actions to existing system Owners. Reversed source vouchers remain included in accounting reports alongside their offsetting reversal voucher.

The sales-workflows migration adds company-scoped sales number series, quotation/order/delivery/invoice headers and lines, immutable event history, source-document/source-line links, payment mode and GST/UTGST tax snapshots, fulfillment counters and unique posting/cancellation idempotency keys. It includes tenant-composite foreign keys, lookup/idempotency indexes and database checks for positive quantities, percentage bounds and non-negative totals. It adds action-level sales and sales-report permissions and grants them to existing system Owners. Revenue, output-tax, COGS and inventory accounts are provisioned idempotently on first sales posting; no extra integration credentials are required.

The purchase-workflows migration adds tenant-scoped purchase number series, purchase orders, receipt notes, supplier invoices and purchase returns with source-document/line links, supplier invoice references, fulfillment counters, immutable events and idempotency uniqueness. Composite company-aware foreign keys, unique supplier invoice references, and document, source, warehouse, cost-centre and event indexes keep the workflow isolated and queryable. It adds purchase and purchase-report permissions and grants them to existing system Owners. Receipt posting books stock against Goods Received Not Invoiced; invoice posting records input GST, supplier/cash settlement, bill-wise payable references and landed freight allocation; returns reverse stock and supplier/tax balances in the same serializable transaction. No additional environment variables are required.

The accounting-payments-and-settlements migration adds cash/bank/cheque/UPI/NEFT/RTGS metadata, credit/debit-note and sales-return voucher types, composite links from bill allocations to customer/supplier invoices or opening bills, cached remaining/settled amounts, reference uniqueness, and open-balance indexes/checks. Existing bill balances are backfilled from posted and reversed ledger activity. New payment/receipt allocations revalidate the open balance at post time and update it transactionally; reversals restore allocations or close the source bill when reversing its invoice. Existing purchase-return documents link to the same settlement source. No new environment variables are needed.

Inventory and voucher tests include database-gated coverage for idempotent opening stock, balanced posting, ledger transaction/Day Book creation, and tenant-scoped queries. Run with `RUN_DB_TESTS=1` against a migrated test database; ordinary unit tests do not require PostgreSQL. The voucher posting API, payload structure, permissions, idempotency headers and attachment delivery are described in [the voucher API guide](./api-vouchers.md). Sales document routes, their state transitions, posting integration, reports and communication adapters are described in [the sales API guide](./api-sales.md).

All API reads and writes must verify an active company membership. Use `requireCompanyContext` for tenant context and `requirePermission(resource, action)` for action checks. Always include `companyId` in subsequent tenant queries. Use transactions for multi-record writes and add audit entries in the same transaction.

## Local workflow

```sh
npm run prisma:generate
npm run db:migrate
npm run db:seed
```

For schema updates, create and review a migration:

```sh
npx prisma migrate dev --name describe_change
npm run prisma:generate
```

Commit both `prisma/schema.prisma` and the generated SQL plus `migration_lock.toml` under `prisma/migrations`. Never use `prisma db push` against production.

## Production workflow

Use `npm run db:migrate:deploy` against the production `DIRECT_URL` to apply already committed migrations. Migrations must be reviewed and deployed before code that requires the new schema. Do not seed or reset production data. `npm run vercel-build` is available for an explicitly configured Vercel build command; coordinate deployment serialization if migrations are run as part of a build.

`DATABASE_URL` should use the Neon pooled connection for application traffic. `DIRECT_URL` should use a direct connection for migration commands. Both values are secrets and belong in Vercel Project Settings.
