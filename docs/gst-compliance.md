# GST compliance module

The GST module extends the existing sales, purchase, voucher, tax-transaction, inventory, settlement and audit workflows. Every route requires an authenticated active company membership and the `company:read` or `company:update` permission, and all queries use the selected company ID.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `PUT` | `/api/gst/registration` | Read or update the company's GSTIN, legal/trade names, state, registration type, filing frequency and selected adapter mode. Updates are audited and also synchronize the company's GSTIN, legal name and state. |
| `POST` | `/api/gst/calculate` | Validate calculation inputs and return tax-exclusive/inclusive CGST, SGST, UTGST, IGST, cess and reverse-charge amounts. |
| `GET` | `/api/gst/reports?periodKey=YYYY-MM&report=...` | Read paginated sales/purchase registers, GSTR-1, GSTR-3B summary, tax ledger or GSTR-2B mismatch rows. Optional `search`, `page`, `pageSize`, and `format=json|csv` filters are supported. |
| `GET`, `POST` | `/api/gst/periods` | Read a period lock or lock/unlock it with a reason and required `Idempotency-Key`. Every change is recorded as a period event and audit entry. |
| `GET`, `POST` | `/api/gst/adjustments` | List or record a sales/purchase credit/debit-note filing adjustment linked to a matching posted note voucher. The note date, period, tax bases and tax components are checked; a required `Idempotency-Key` protects writes. |
| `GET`, `POST` | `/api/gst/reconciliation` | List recent GSTR-2B reconciliation uploads or upload a normalized CSV/JSON file for matching. Uploads require private Vercel Blob storage and an `Idempotency-Key`. |

JSON report results use page/page-size pagination (maximum 100 rows per page). CSV exports contain the complete filtered period, not only the currently viewed page, and are capped at 10,000 rows. GSTR-1 CSV rows include both invoice and credit/debit-note records, distinguished by `recordType`. GSTR-3B returns a summarized dataset containing outward taxable value and output tax, input tax credit, and reverse-charge liability.

## Tax and posting behavior

- GSTIN values are normalized and checked for state, format and checksum. HSN/SAC validation checks supported code lengths and identifies six-digit SAC codes.
- Decimal arithmetic calculates intra-state CGST plus SGST, intra-UT CGST plus UTGST, inter-state IGST, cess and inclusive pricing. Reverse-charge lines exclude supplier-collected tax from the invoice total.
- Sales and purchase drafts persist tax-rate, cess, inclusive-pricing and reverse-charge snapshots. Existing serializable posting transactions continue to update balanced vouchers, tax ledgers/transactions, bill-wise outstanding, inventory and batch/godown balances, cost allocations, document events and audit history together.
- GST-period locks are checked while posting or reversing sales invoices and purchase invoices/returns. Purchase invoices use the supplier invoice date for the GST period.
- Purchase reverse charge creates matched input-tax and output-liability tax entries. Posted note adjustments must match their linked posted voucher and are included in GSTR-1/GSTR-3B datasets.
- GSTR-2B uploads accept normalized CSV or JSON rows with supplier GSTIN, invoice number/date and taxable/tax component amounts. Results match company purchase invoices and report matched, mismatched and missing-in-books rows. Uploads are privately stored in Vercel Blob; the application does not write uploaded content to local disk.

## External portal adapters

Registration stores `SANDBOX` or `LIVE` as the selected adapter mode. The GST datasets, CSV export and GSTR-2B reconciliation are local ERP workflows. No GST portal filing, GSTIN lookup, e-invoice or e-waybill request is sent by this module: the existing `GST_API_*`, `EINVOICE_API_*` and `EWAYBILL_API_*` environment variables are configuration names only. A provider-specific adapter must be implemented against the selected GSP/API contract before enabling external submission; this module deliberately does not guess endpoint paths or payload/authentication formats.

No new environment variables are required. Keep provider credentials in Vercel Project Settings and configure `BLOB_READ_WRITE_TOKEN` for reconciliation uploads. The names-only variable list is maintained in `.env.example`.

## Database and verification

The `20261109110000_indian_gst_engine` migration adds GST registration, period/event, reconciliation and adjustment tables, tenant-aware foreign keys, uniqueness, indexes and database checks, and extends sales/purchase document tax snapshots. Apply it with `npm run db:migrate` locally or `npm run db:migrate:deploy` in production.

Run `npm run test` for unit tests. Database-backed period and purchase-posting integration tests are gated by `RUN_DB_TESTS=1` and require a migrated test database. Playwright coverage verifies that `/dashboard/gst` redirects unauthenticated users to sign-in.
