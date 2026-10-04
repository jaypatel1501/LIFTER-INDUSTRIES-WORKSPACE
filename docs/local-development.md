# Local development

## Requirements

- Node.js 22 and npm
- Docker Desktop with Compose, or PostgreSQL 17
- Windows PowerShell, macOS or Linux terminal

## Start PostgreSQL with Docker Compose

```sh
docker compose up -d postgres
```

The local-only database is available on port 5432 (`erp` / `erp_local_only`). Do not reuse this password outside a local development machine. The named volume persists database contents between restarts.

## Configure local environment

Create `.env` in the repository root. Prisma CLI loads this file directly, and Next.js uses it for the application. `.env.example` intentionally lists variable names only; populate values in your local file and never commit it.

```dotenv
DATABASE_URL=postgresql://erp:erp_local_only@localhost:5432/erp?schema=public
DIRECT_URL=postgresql://erp:erp_local_only@localhost:5432/erp?schema=public
AUTH_SECRET=<random value of at least 32 characters>
AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=ERP System
EMAIL_SERVER="smtp://USERNAME:PASSWORD@SMTP_HOST:SMTP_PORT"
EMAIL_FROM="ERP <no-reply@example.com>"
SEED_ADMIN_EMAIL=admin@local.test
SEED_ADMIN_PASSWORD=<strong local-only password>
```

The seed is development-only and requires `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. It creates an initial development administrator and company, and refuses to run when `NODE_ENV=production`.

## Install, migrate and run

```sh
npm install
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. Prisma CLI and Next.js both load the root `.env` file. The PostgreSQL URLs above work for the local Docker service.

## Optional integrations

- Configure `EMAIL_SERVER` and `EMAIL_FROM` together to enable registration verification, resend verification, password reset and company invitation emails. `EMAIL_SERVER` uses the existing SMTP service and must be an `smtp://` or `smtps://` URL; URL-encode reserved characters in its username or password. `EMAIL_FROM` may be a plain address or a display name and address. Email links retain the canonical `AUTH_URL` or `NEXT_PUBLIC_APP_URL`. The reset endpoint does not disclose whether an account exists.
- Configure `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` and `SMS_API_URL` together to enable mobile OTP. The configured REST gateway receives `POST` JSON `{ "provider", "from", "to", "message" }` and a bearer API key; it must return a 2xx response only after accepting the message.
- Configure `BLOB_READ_WRITE_TOKEN` for private Vercel Blob storage. Upload helpers require an authenticated active company and store files under a company-specific path; company logos are served through an authenticated proxy and limited to 2 MB.
- GST, e-invoice, e-waybill and WhatsApp credential groups are validated as complete sets before configured integrations are used.

## Tests and utilities

```sh
npm run lint
npm run typecheck
npm run test
npx playwright install chromium
npm run test:e2e
npm run build
npm run db:studio
```

The Playwright smoke suite launches the Next.js development server with isolated test configuration. Jest includes unit tests and route-level integration tests. Database-dependent integration tests should use an isolated database and never target production.
