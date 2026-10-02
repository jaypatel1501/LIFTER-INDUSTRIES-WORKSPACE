# ERP System

Enterprise-oriented Indian business ERP foundation built on Next.js App Router, strict TypeScript, PostgreSQL/Neon and Prisma. This repository currently contains the shared platform foundation only; accounting, sales, inventory, payroll, manufacturing, POS and GST business modules are intentionally out of scope.

## Foundation

- Auth.js JWT sessions with bcrypt-backed email/password sign-in, mobile OTP adapter, account lockout, password reset, and session revocation after password reset.
- Company-scoped membership, company roles, global permission catalog and reusable RBAC/tenant guards.
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

See [local development](./docs/local-development.md), [database migrations](./docs/database-migrations.md), [Vercel deployment](./docs/vercel-deployment.md), and the [foundation API reference](./docs/api-foundation.md).

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

Every company-owned query must use a verified active membership and include its `companyId`. Enforce action-level access with `requirePermission`; keep financial posting in Prisma transactions with idempotency keys, audit events and immutable posted records when those business modules are introduced. Credentials and integration tokens are server-only environment variables. Production secrets belong in Vercel Project Settings.
