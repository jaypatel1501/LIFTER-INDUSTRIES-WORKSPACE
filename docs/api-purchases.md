# Purchase workflow API

Purchase routes use authenticated Next.js App Router handlers. Each request verifies active company membership and the permission listed below. Reads and writes are company-scoped; posting and cancellation run in serializable Prisma transactions and require `Idempotency-Key` headers.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET`, `POST` | `/api/purchases` | `purchases:read`, `purchases:create` | Search/paginate documents or create purchase-order and standalone-invoice drafts. |
| `GET` | `/api/purchases/options` | `purchases:read` | Load active suppliers, items, godowns, cash/bank ledgers and cost centres. |
| `GET` | `/api/purchases/{documentId}` | `purchases:read` | Read company-scoped document, lines, source, voucher and event history. |
| `POST` | `/api/purchases/{documentId}/issue` | `purchases:issue` | Issue a draft order. |
| `POST` | `/api/purchases/{documentId}/convert` | `purchases:create` | Convert an eligible order to a receipt/invoice, a receipt to an invoice, or an invoice to a return. Source quantities are checked server-side. |
| `POST` | `/api/purchases/{documentId}/post` | `purchases:post` | Post a receipt, supplier invoice or purchase return atomically to voucher, ledger, tax, bill-wise and inventory systems. |
| `POST` | `/api/purchases/{documentId}/cancel` | `purchases:cancel` | Cancel an unposted document or reverse its voucher and stock; requires a reason and reversal date. |
| `GET` | `/api/purchases/reports?report=register` | `purchase-reports:read` | Paginated purchase invoice/return register with GST and total summaries. |
| `GET` | `/api/purchases/reports?report=analysis` | `purchase-reports:read` | Supplier spend and stock-item purchase analysis net of posted returns. |

Draft lines resolve item HSN/SAC, GST rate and base unit from the active company. Supplier invoices require the supplier's invoice number and date; duplicate references for the same supplier/company are rejected. Item receipt/invoice/return lines require an active company godown. Batch-tracked stock requires a batch number at posting, with optional manufacturing and expiry dates. Cash invoices require an active cash/bank ledger; credit invoices use the supplier's linked party ledger and create bill-wise payable details against the supplier reference.

Purchase orders must be issued before conversion. Receipt notes increase godown and batch stock, and debit Stock on Hand against Goods Received Not Invoiced. An invoice created from a receipt clears that accrual; a direct order invoice receives stock itself and cannot duplicate quantities already received. Freight is apportioned proportionally over stock lines and capitalized into inventory unit cost; service-only freight is expensed. Purchase invoices debit eligible input CGST/SGST/UTGST/IGST ledgers, post supplier or cash settlement, and create tax transactions. Returns reduce inventory, supplier payable and input-tax credit, with the original bill reference retained for bill-wise settlement.

Every posting also uses the existing shared voucher platform for balanced voucher numbering, ledger transactions, tax details, Day Book history and audit records. Inventory movement and batch balances, source fulfillment, cost-centre allocations and document event history are written in the same transaction. Posted source documents remain immutable; cancellation creates a shared accounting reversal and stock reversal. Existing Owner roles receive the new permissions through the purchase migration. No new environment variables or local file storage are used.
