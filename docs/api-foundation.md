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
| `GET` | `/api/audit?take=50&cursor=...` | `audit:read` permission | Read cursor-paginated audit events scoped to the active company. |
| `PATCH` | `/api/profile/locale` | Authenticated | Persist English, Hindi or bilingual preference. |
| `GET`, `POST` | `/api/auth/[...nextauth]` | Auth.js | Auth.js sign-in, session and sign-out handlers. |

Company switching uses a short-lived server-signed proof returned only after membership verification. The Auth.js JWT callback verifies the proof and membership, applies a session-scoped rate limit and writes an IP/user-agent audit record before changing the active company claim; dashboard queries also re-check membership.

No accounting, inventory or other business-module posting API is included yet. When posting operations are added, require an `Idempotency-Key`, RBAC and company checks, one serializable Prisma transaction, immutable posted-document state, and audit records for the document and all related ledger, stock, tax and outstanding updates.
