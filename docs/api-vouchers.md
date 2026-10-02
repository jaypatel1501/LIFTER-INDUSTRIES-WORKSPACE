# Voucher and posting API

All paths are Next.js App Router Route Handlers. JSON responses use `{ success, data, error }`. Every handler verifies active membership and the active company's action-level permission; all database reads and writes are constrained by `companyId`. Financial mutations are performed in serializable Prisma transactions and write an audit event and Day Book entry in the same transaction.

## Voucher lifecycle

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET`, `POST` | `/api/accounting/vouchers` | `vouchers:read`, `vouchers:create` | Filter/paginate vouchers, or create an idempotent draft. |
| `GET`, `PATCH` | `/api/accounting/vouchers/{voucherId}` | `vouchers:read`, `vouchers:update` | Read company-scoped details/history, or replace draft lines and accounting metadata. Posted vouchers cannot be edited. |
| `POST` | `/api/accounting/vouchers/{voucherId}/post` | `vouchers:post` | Validate the financial year, approval status and debit/credit equality; atomically create ledger and tax transactions and any stock movements. |
| `POST` | `/api/accounting/vouchers/{voucherId}/cancel` | `vouchers:cancel` | Cancel a draft. Posted documents cannot be cancelled. |
| `POST` | `/api/accounting/vouchers/{voucherId}/request-approval` | `vouchers:update` | Move a series-configured draft to approval-pending. |
| `POST` | `/api/accounting/vouchers/{voucherId}/approve` | `vouchers:approve` | Approve or reject a pending draft. The draft creator cannot approve their own document. |
| `POST` | `/api/accounting/vouchers/{voucherId}/reverse` | `vouchers:reverse` | Create a balanced reversing voucher, reverse linked stock movements, retain both records, and require a reason/date. |
| `GET` | `/api/accounting/vouchers/options` | `vouchers:read` | Load tenant-owned ledgers, cost centres, financial years, number series and inventory options. |
| `POST` | `/api/accounting/vouchers/{voucherId}/attachments` | `vouchers:update` | Upload a PDF or validated image (maximum 10 MB) to private Vercel Blob storage and attach it to a draft. |
| `GET` | `/api/accounting/vouchers/{voucherId}/attachments/{attachmentId}` | `vouchers:read` | Stream a tenant-verified private attachment; object-storage URLs are not exposed as public links. |

Draft creation, posting, cancellation, approval requests, approval decisions and reversal require a unique `Idempotency-Key` header. Replaying the same key and request returns the existing result; reusing a key for a different operation returns a conflict. Draft updates are replace operations and use `PATCH`; the server writes before/after line metadata to immutable voucher history. Attachments must use the authenticated upload endpoint rather than client-supplied object metadata.

Draft bodies are validated by [`lib/validation/vouchers.ts`](../lib/validation/vouchers.ts). Each line selects one active company ledger and has a debit or credit amount. Optional line details include bill-wise references, tax records, cost-centre allocations and one inventory movement. `ADJUSTMENT` may be inbound or outbound; other movement types require their matching direction. Posting rejects an unbalanced or zero-total voucher, inactive/foreign ledgers or dimensions, closed/missing financial periods, and stock movements that violate current inventory rules.

## Supporting accounting controls

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET`, `POST` | `/api/accounting/voucher-series` | `voucher-series:manage` | List/create company and financial-year number series, including approval requirements. |
| `PATCH` | `/api/accounting/voucher-series/{seriesId}` | `voucher-series:manage` | Change prefix/suffix, next number, padding, approval requirement or active state. The next number cannot be lowered. |
| `GET`, `POST` | `/api/accounting/cost-centres` | `vouchers:read`, `cost-centres:manage` | Paginate/search cost centres or create a unique company-scoped centre. |
| `PATCH` | `/api/accounting/cost-centres/{costCentreId}` | `cost-centres:manage` | Activate/deactivate a centre without changing historical allocations. |
| `GET` | `/api/accounting/day-book` | `vouchers:read` | Filter/paginate draft, approval, posting, cancellation and reversal source events. |
| `GET` | `/api/accounting/tax-transactions` | `vouchers:read` | Filter/paginate tax details, including reversal transactions. |

The protected dashboard screens are `/dashboard/vouchers`, `/dashboard/vouchers/{voucherId}`, `/dashboard/day-book`, `/dashboard/tax-transactions`, `/dashboard/voucher-series` and `/dashboard/cost-centres`. The trial balance and ledger/party histories include both `POSTED` vouchers and `REVERSED` source vouchers so an offsetting reversal correctly nets the original accounting entry to zero. Both original and reversal records remain visible in the Day Book and audit trail.

Apply the committed schema before deploying these handlers using `npm run db:migrate:deploy`; the new schema fields are required by voucher APIs.
