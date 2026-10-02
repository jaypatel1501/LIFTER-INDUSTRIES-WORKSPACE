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
| `PATCH` | `/api/profile/locale` | Authenticated | Persist English, Hindi or bilingual preference. |
| `GET`, `POST` | `/api/auth/[...nextauth]` | Auth.js | Auth.js sign-in, session and sign-out handlers. |

Company switching uses a short-lived server-signed proof returned only after membership verification. The Auth.js JWT callback verifies the proof and membership, applies a session-scoped rate limit and writes an IP/user-agent audit record before changing the active company claim; dashboard queries also re-check membership.

All management handlers verify the active membership and resource/action permission before querying or writing company records. Role and membership mutations, financial-year changes, company settings, session revocations, and their audit events use Prisma transactions. Deactivating a membership revokes the affected user's active sessions and advances the global session version. The company must retain at least one active Owner.

Invitations require `EMAIL_SERVER`, `EMAIL_FROM`, and a canonical `AUTH_URL` or `NEXT_PUBLIC_APP_URL`. A newly invited account receives a one-time 30-minute password-setup link; existing accounts receive a sign-in link. A delivery failure is returned explicitly, leaves the invitation pending, and can be retried from the user list. Company logos use private Vercel Blob storage and are served only through the authenticated company-scoped logo route.

No accounting, inventory or other business-module posting API is included yet. When posting operations are added, require an `Idempotency-Key`, RBAC and company checks, one serializable Prisma transaction, immutable posted-document state, and audit records for the document and all related ledger, stock, tax and outstanding updates.
