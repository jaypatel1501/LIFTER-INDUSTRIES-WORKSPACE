# Vercel deployment

## Provisioning

1. Create a Vercel project connected to this GitHub repository and deploy `main` through Vercel's Next.js framework integration.
2. Link a Neon PostgreSQL database through the Vercel Marketplace.
3. Add a Vercel Blob store if files are enabled for the deployment.
4. Configure environment variables in Vercel Project Settings for Preview and Production as appropriate. Never commit `.env` files, credentials or database URLs.

## Environment variables

Use `.env.example` as a names-only checklist. Set at minimum:

- `DATABASE_URL` — Neon pooled PostgreSQL URL.
- `DIRECT_URL` — Neon direct PostgreSQL URL for Prisma migrations.
- `AUTH_SECRET` — random value of at least 32 characters.
- `AUTH_URL` and `NEXT_PUBLIC_APP_URL` — canonical HTTPS application URL.
- `NEXT_PUBLIC_APP_NAME` — display name.

Set `AUTH_URL` and `NEXT_PUBLIC_APP_URL` to the existing canonical HTTPS production URL, and configure `EMAIL_SERVER` and `EMAIL_FROM` together in Vercel Production to enable registration verification, resend verification, password reset, and company invitation emails. `EMAIL_SERVER` must be an `smtp://` or `smtps://` URL for the existing SMTP service; URL-encode reserved characters in its username or password. `EMAIL_FROM` must be an address accepted by that SMTP account and may include a display name, for example `ERP <no-reply@example.com>`. These values are read only by server code. Missing values are reported by variable name, never by secret value. Verification links retain the existing canonical `NEXT_PUBLIC_APP_URL` / `AUTH_URL` resolution. OTP requires `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID`, and `SMS_API_URL`; `SMS_API_URL` must implement the JSON gateway contract in [local development](./local-development.md). Set `BLOB_READ_WRITE_TOKEN` for private object storage, company logos and voucher attachments. GST, e-invoice, e-waybill, and WhatsApp credentials are optional and validated as complete groups.

Only `NEXT_PUBLIC_*` variables are exposed to browser bundles. Keep database, Auth.js, mail, SMS, GST and storage credentials server-only.

## Build and migrations

The normal Next.js build command is `npm run build`. Before deploying code that depends on schema changes, run `npm run db:migrate:deploy` using the production environment and a direct Neon connection. Serialize production migrations and deploys.

If the project is deliberately configured to run migrations during Vercel builds, use `npm run vercel-build` and ensure deployments cannot apply conflicting schema changes concurrently. Avoid production seeding.

GitHub Actions runs Prisma client generation, lint, type checking, Jest, Playwright smoke tests and a production build on pushes and pull requests. A successful merge to `main` can then trigger Vercel's automatic deployment.

## Probes

Configure `/api/health` as a liveness check and `/api/readiness` as a readiness check. The readiness endpoint requires a working database connection.
