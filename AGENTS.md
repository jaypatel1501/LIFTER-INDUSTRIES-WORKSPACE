# ERP System - Architecture & Implementation Guidelines

## Overview
This is a **production-ready, enterprise-grade Indian Business Accounting, Inventory, GST, Payroll, Manufacturing, POS, Job Work and ERP application** — a real end-to-end system, not a demo, prototype, or placeholder implementation.

## Mandatory Stack

### Frontend & Framework
- **Next.js App Router** (current stable release)
- **TypeScript** in strict mode
- **Tailwind CSS** and **shadcn/ui** for UI components
- **React Hook Form** + **Zod** for form validation
- **TanStack Query** (React Query) for server state management
- **Zustand** for lightweight browser UI state only

### Backend & Database
- **Next.js Route Handlers** in `app/api/` (no Express, NestJS, or separate backend)
- **PostgreSQL** via Neon (production-ready, serverless)
- **Prisma ORM** with PostgreSQL schema
- **Auth.js/NextAuth** with JWT strategy
- **Vercel Blob** or S3-compatible storage for persistent files

### Development & Deployment
- **Vercel** for hosting (GitHub main branch → auto-deploy)
- **Neon Marketplace** linked through Vercel
- **Environment variables** only via Vercel Project Settings
- Local and production use **identical source code**

## Critical Principles

### 1. Financial Integrity (Non-Negotiable)
Every financial operation must be:
- **Atomic**: Wrapped in Prisma transactions
- **Idempotent**: Using idempotency keys to prevent duplicate posting
- **Audited**: Logged with user, timestamp, IP, changes, and reason
- **Immutable**: Posted documents cannot be edited; only cancelled, reversed, or noted
- **Connected**: All related ledgers, stock, GST, outstanding, and reports update in one atomic transaction

**Supported Operations:**
- Sales, Purchase, Payment, Receipt, Contra, Journal
- Returns, Stock Adjustments, Batch Movements
- Payroll, Manufacturing, Job Work
- GST compliance, Bill-wise Outstanding
- Cost Allocation, Depreciation

### 2. Multi-Company & Tenant Isolation
- One user belongs to **multiple companies** (organizations)
- Every company-owned table includes `companyId` (foreign key, indexed)
- **Every API query** verifies user's active company membership
- Company-level roles and module/screen/action permissions
- Strict data isolation: no data leakage between companies

### 3. Authentication & Security
Implement:
- Email/password login with bcrypt/Argon2 hashing
- Mobile OTP login (SMS-based), logout, password change
- Forgot password / reset password with email link
- OTP expiry (default 15 min), retry limits, failed-login tracking
- Login history and session/device tracking
- Rate limits: 5 login attempts per 15 min, 3 OTP requests per 15 min
- Password reset only via email verification
- No secrets in client components
- All sensitive operations require rate limiting

### 4. Localization (English, Hindi, Bilingual)
- UI labels in English and Hindi
- Accounting data stored in **locale-neutral formats** (ISO date, currency as decimal)
- Bilingual reports and documents (Devanagari numerals optional)
- User preference stored in profile (English, हिंदी, Bilingual)

### 5. Environment & Secrets
**Never commit:**
- `.env`, `.env.local`
- `.env.example` must contain **names only** (no values)
- Database URLs, API keys, OTP credentials
- Backups, node_modules, .next

**Required Environment Variables:**
```
# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# Auth
AUTH_SECRET=<32+ random chars>
AUTH_URL=https://app.example.com

# App
NEXT_PUBLIC_APP_URL=https://app.example.com
NEXT_PUBLIC_APP_NAME=ERP System

# Storage
BLOB_READ_WRITE_TOKEN=...

# SMS & Email
SMS_PROVIDER=twilio|exotel|msg91
SMS_API_KEY=...
SMS_SENDER_ID=...
EMAIL_SERVER=smtp://...
EMAIL_FROM=noreply@example.com

# GST, E-Invoice, E-Waybill APIs
GST_API_BASE_URL=...
GST_API_CLIENT_ID=...
GST_API_CLIENT_SECRET=...
EINVOICE_API_BASE_URL=...
EINVOICE_API_CLIENT_ID=...
EINVOICE_API_CLIENT_SECRET=...
EWAYBILL_API_BASE_URL=...
EWAYBILL_API_CLIENT_ID=...
EWAYBILL_API_CLIENT_SECRET=...

# WhatsApp
WHATSAPP_API_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
```

Validate all variables in `lib/env.ts`. Only `NEXT_PUBLIC_*` variables are visible to browser.

### 6. Database Migrations & Deployment
- **Schema file**: `prisma/schema.prisma` (committed)
- **Migration files**: `prisma/migrations/*/` (committed)
- **Local**: `npm run db:migrate` (prisma migrate dev)
- **Production**: `npm run db:migrate:deploy` (prisma migrate deploy)
- **Never**: Use `prisma db push` in production or reset production database
- **Seed data**: Only in dev/staging; never auto-seed production
- **Singleton**: Use `lib/prisma.ts` for all Prisma client access

### 7. Serverless & Stateless Design
- **No long-running processes** on Vercel Functions
- **No setInterval or persistent workers** (use Vercel Cron for schedules)
- **No local disk writes** (use Vercel Blob/S3 for storage)
- **No in-memory queues** (use Vercel KV or external job queue if needed)
- **Stateless Route Handlers** only
- **Pagination/cursor pagination** for large reports and lists

### 8. Required Shared Files (Committed to Repo)
```
AGENTS.md                              (this file)
lib/env.ts                             (validate environment variables)
lib/prisma.ts                          (Prisma client singleton)
lib/auth.ts                            (NextAuth config & helpers)
lib/permissions.ts                     (RBAC & company isolation checks)
lib/audit.ts                           (audit log insertion & retrieval)
lib/idempotency.ts                     (idempotency key generation & validation)
lib/transactions.ts                    (atomic transaction helpers)
lib/errors.ts                          (custom error classes)
lib/api-response.ts                    (standardized API response format)
middleware.ts                          (auth, company context, rate limiting)
app/api/health/route.ts                (GET /api/health - health check)
app/api/readiness/route.ts             (GET /api/readiness - readiness probe)
.env.example                           (variable names only)
.gitignore                             (.env*, node_modules, .next, etc.)
README.md                              (overview, setup, deployment)
docs/local-development.md              (local setup, npm run commands)
docs/vercel-deployment.md               (Vercel env vars, linking Neon, CI/CD)
docs/database-migrations.md            (schema design, migration workflow)
.github/workflows/ci.yml               (lint, type-check, test, build on PR/push)
package.json                           (scripts: dev, build, start, lint, typecheck, test, test:watch, test:e2e, prisma:generate, db:migrate, db:migrate:deploy, db:seed, db:studio, vercel-build)
```

### 9. NPM Scripts
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --ext .ts,.tsx",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "playwright test",
    "prisma:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio",
    "vercel-build": "prisma generate && prisma migrate deploy && next build"
  }
}
```

### 10. Local Development
**Commands to always work:**
```bash
npm install
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run dev
```

This must set up a complete local PostgreSQL (via Docker or local install), run all migrations, seed dev data, and start the dev server at `localhost:3000`.

**Production environment variables** must be set in Vercel Project Settings (never in `.env`).

### 11. CI/CD Workflow (.github/workflows/ci.yml)
On every pull request and push:
1. Install dependencies
2. Run `npm run prisma:generate`
3. Run `npm run lint`
4. Run `npm run typecheck`
5. Run `npm run test`
6. Run `npm run build`

On successful merge to `main`:
- Vercel automatically deploys

### 12. Definition of DONE for Each Phase

**Before stopping work, ensure:**

✅ **Database**
- Prisma migrations created and committed
- Indexes and constraints defined
- No N+1 queries
- Pagination implemented for large datasets

✅ **API**
- Route handlers created (not mock/fake)
- Request validation with Zod
- Error handling with proper HTTP status codes
- Transaction safety for financial operations
- Idempotency key support where applicable
- Rate limiting on sensitive endpoints

✅ **Frontend**
- Real UI components (not wireframes/placeholders)
- Loading states, empty states, error states
- Form validation with React Hook Form + Zod
- Accessibility (ARIA, keyboard navigation)
- Mobile responsive (Tailwind, shadcn/ui)

✅ **Security & Compliance**
- RBAC: User has required permission for action
- Company isolation: User can only access own company data
- Audit log: Every write operation logged
- No sensitive data in logs or error messages

✅ **Financial Safety**
- Posting operations atomic (Prisma transaction)
- Idempotency keys for duplicate prevention
- Posted documents immutable (no edit, only reverse/cancel)
- All related records updated together (ledger, stock, GST, outstanding)

✅ **Testing**
- Unit tests for business logic
- Integration tests for API + database
- E2E tests for critical workflows (login, posting, reporting)

✅ **Documentation**
- Updated README
- API endpoint documented (method, path, auth, params, response)
- Database schema changes documented
- Complex logic explained in comments

✅ **Quality Gates**
```bash
npm run prisma:generate   # No errors
npm run lint              # No warnings
npm run typecheck         # No type errors
npm run test              # All pass
npm run build             # Success
```

### 13. No Placeholders or TODOs
- ❌ "TODO: implement this later"
- ❌ Fake buttons with no backend
- ❌ Mock-only routes (e.g., `/api/fake-data`)
- ❌ Disconnected UI pages (UI without backend)
- ❌ Static dashboards (hardcoded data)
- ❌ Placeholder components

**Every feature is real, tested, and production-ready.**

---

## Quick Reference: Key Files & Responsibilities

| File | Responsibility |
|------|-----------------|
| `lib/env.ts` | Load & validate env vars at startup |
| `lib/prisma.ts` | Prisma client singleton |
| `lib/auth.ts` | NextAuth config, session, JWT |
| `lib/permissions.ts` | RBAC checks, company isolation |
| `lib/audit.ts` | Audit log creation & queries |
| `lib/idempotency.ts` | Idempotency key validation |
| `lib/transactions.ts` | Atomic transaction wrappers |
| `lib/errors.ts` | Custom error classes (AppError, ValidationError, etc.) |
| `lib/api-response.ts` | { success, data, error, meta } response format |
| `middleware.ts` | Auth, company context, rate limiting |
| `app/api/` | All REST API route handlers |
| `prisma/schema.prisma` | Database schema (committed) |
| `prisma/migrations/` | Migration history (committed) |

---

## Implementation Strategy

### Phase 1: Core Infrastructure
- [ ] Initialize Next.js with App Router, TypeScript, Tailwind, shadcn/ui
- [ ] Set up Prisma + Neon PostgreSQL
- [ ] Create lib/env.ts, lib/prisma.ts, lib/auth.ts
- [ ] Implement Authentication (email/password, mobile OTP)
- [ ] Create middleware for auth & company context

### Phase 2: Foundation Models
- [ ] Company, User, Role, Permission (multi-company RBAC)
- [ ] Chart of Accounts, Cost Centers
- [ ] Party (Customer, Supplier, Employee)
- [ ] Item Master, Batch, Godown
- [ ] Unit of Measure

### Phase 3: Core Modules
- [ ] **Accounting**: Ledger, Journal, Payment, Receipt, Contra
- [ ] **Sales**: Quotation, Sales Order, Delivery, Sales Invoice
- [ ] **Purchase**: Purchase Requisition, PO, GRN, Purchase Invoice
- [ ] **Inventory**: Stock, Batch Tracking, Warehouse, Godown

### Phase 4: GST & Compliance
- [ ] GST Configuration (SGST, CGST, IGST rates)
- [ ] GST Posting (automatic on invoices)
- [ ] E-Invoice Integration
- [ ] E-Waybill Integration
- [ ] GST Reports (GSTR-1, GSTR-2B, etc.)

### Phase 5: Advanced Modules
- [ ] **Manufacturing**: BOM, Work Order, Material Issue, Production
- [ ] **Job Work**: Job Work Order, Material Issue, Completion
- [ ] **Payroll**: Employee Master, Salary Structure, Attendance, Payroll Run
- [ ] **POS**: Point of Sale (real-time inventory, quick checkout)

### Phase 6: Reporting & Analytics
- [ ] Financial Statements (P&L, Balance Sheet, Trial Balance)
- [ ] Inventory Reports (Stock Valuation, Stock Aging)
- [ ] Sales & Purchase Analysis
- [ ] GST Reports
- [ ] Dashboard with KPIs

---

## Contact & Support
For questions or clarifications on this architecture, refer to:
- `docs/local-development.md` for local setup
- `docs/vercel-deployment.md` for production deployment
- `docs/database-migrations.md` for schema changes
- Individual module READMEs for feature-specific guidance

---

**Last Updated**: 2026-10-02
**Version**: 1.0
**Status**: Active Development

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
