# Database and migrations

## Schema

`prisma/schema.prisma` uses PostgreSQL and defines users, companies, memberships, company roles, global permissions, role and membership joins, audit events, password reset tokens, OTP challenges, login history, auth sessions, rate limits, and company financial years. Company configuration covers Indian tax identifiers, registered address/contact details, logo object URL, time zone/currency, books-beginning date, and financial-year start month.

Company-owned records include a `companyId` foreign key, an index, and tenant-aware uniqueness where applicable. Membership and permission joins have composite primary keys. Foreign keys specify deletion behavior; audit entries restrict company deletion and retain actor history when a user is deleted.

The company-management migration adds the financial-year table and its company foreign key, date-range and company/start-date constraints, PAN/GSTIN/state-code checks, and indexes for PAN, GST state and financial-year filtering. It also backfills the company-management action catalog, grants existing system Owners the new management actions, and creates a standard Member group for existing companies.

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
