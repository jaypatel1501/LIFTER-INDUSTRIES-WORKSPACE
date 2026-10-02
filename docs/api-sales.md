# Sales workflow API

The sales APIs are authenticated Next.js App Router handlers. Every request verifies current company membership and the specific permission shown below; data access is always scoped to `companyId`. Financial mutations run at serializable transaction isolation and require an `Idempotency-Key` header.

## Documents

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET`, `POST` | `/api/sales` | `sales:read`, `sales:create` | Search and paginate quotations/orders, or create an idempotent draft. |
| `GET` | `/api/sales/options` | `sales:read` | Load active customers, items, warehouses and cash/bank ledgers for forms. |
| `GET` | `/api/sales/{documentId}` | `sales:read` | Read tenant-scoped document, snapshots, line details and immutable event history. |
| `POST` | `/api/sales/{documentId}/transition` | `sales:issue` / `sales:update` | Issue a draft or accept/reject an issued quotation. |
| `POST` | `/api/sales/{documentId}/convert` | `sales:create` | Convert an accepted quotation to an order, or an eligible order/delivery to delivery/invoice drafts. Fulfillment quantities are checked server-side. |
| `POST` | `/api/sales/{documentId}/post` | `sales:post` | Post a delivery note or invoice with its shared accounting voucher, inventory movements, ledger/tax/bill-wise transactions and audit trail. |
| `POST` | `/api/sales/{documentId}/cancel` | `sales:cancel` | Cancel an unposted document or atomically create a reversing voucher and reverse stock for a posted document. Requires a reason and reversal date. |
| `POST` | `/api/sales/{documentId}/send` | `sales:send` | Send an issued/accepted/posted document by SMTP email or configured WhatsApp Cloud API. |
| `GET` | `/api/sales/reports` | `sales-reports:read` | Paginated posted sales register/profitability or customer sales summaries. |

The create request accepts quotation or sales-order data with customer, document date, billing/shipping snapshots, freight/other charges, round-off and up to 100 lines. Item GST rate/HSN and base unit are resolved from the current company's item master. For a service line, provide the GST rate explicitly. Tax jurisdiction and CGST/SGST/UTGST versus IGST are calculated on the server from the company's and customer's state codes. For applicable union territories, the GST split uses CGST and UTGST.

Convert requests provide source line IDs, quantities, and—where relevant—warehouse and batch selection. A quotation must be accepted before order conversion. Delivery/invoice lines are validated against active company items and fulfillable source quantities. Invoice cash mode requires an active company cash/bank ledger; credit mode uses the customer's linked ledger and checks current ledger outstanding against the credit limit.

Posted invoices create a balanced `SALES` voucher, output tax ledgers and transactions, bill-wise receivable for credit sales, inventory/COGS records for goods not already delivered, and linked audit/Day Book records in one serializable transaction. Posted delivery notes atomically create inventory-out movements and matching COGS/Stock-on-Hand ledger entries. Cancelling a posted document calls the shared voucher reversal service in the same transaction, restoring inventory and preserving the immutable original/reversal history.

The protected screens are `/dashboard/sales`, `/dashboard/sales/{documentId}`, `/dashboard/sales/{documentId}/print`, and `/dashboard/sales-reports`. Invoice print views are bilingual and browser-print ready. Communication requires the existing `EMAIL_SERVER`/`EMAIL_FROM` configuration or both `WHATSAPP_API_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`; no additional environment variables are introduced.
