# Backend APIs — Inventory & REST Map

> **Generated:** 2026-06-29 · Branch: `classification__rules_category`
> **Scope:** Whole codebase (excludes `legacy/`). Counts verified directly from source via `grep` of exported functions, not estimated.

WB Brands Finance OS is mid-migration from a legacy vanilla-JS app to **Next.js 15 (App Router)**. The backend today is almost entirely **Next.js Server Actions** (RPC-style functions invoked from React) plus **direct Supabase read helpers** called by server components, and exactly **one** real HTTP route (`POST /api/ai`).

This document does two things:
1. **Inventories** every backend operation that exists today (the API surface).
2. **Maps** each to the **REST endpoint** it would become if the backend were exposed over HTTP (e.g. for a mobile/external client or a decoupled API), and flags **gaps**.

---

## 1. Summary — endpoint count

| Category | Count | Where |
|---|---:|---|
| **Server Actions** (writes / RPC) | **57** | `actions/*.ts` (49) + `app/**/actions.ts` (8) |
| **Read query helpers** (GET-equivalent, hit Supabase) | **33** | `lib/queries/*.ts` |
| **External Admin-API read helpers** | **2** | `lib/admin-api/reports.ts` |
| **HTTP route handlers** | **1** | `app/api/ai/route.ts` |
| **TOTAL backend operations** | **93** | |

- Normalized into the **REST map** below, these 93 operations become **~80 HTTP endpoints across 16 resource groups** (some read pairs collapse into one endpoint with query params).
- **Strictest definition** (only `app/api/**/route.ts` HTTP handlers): the answer is **1**. In this codebase, Server Actions *are* the API — that's why the meaningful number is 93.

### Counting methodology — what's excluded

To keep the count honest, these are **deliberately excluded** (they are not callable endpoints):

| Excluded | Count | Why |
|---|---:|---|
| Pure in-memory compute helpers in `lib/queries/` | 9 | Transform already-fetched rows; no DB access. `groupByAccount`, `groupByAccountAndEntity`, `groupByLine`, `groupBalanceByAccount`, `monthlyBalanceSnapshots`, `totals`, `pnlAdjustment`, `mergeManualEntriesIntoAggregates`, `bucketByDay`. |
| Internal DB-lookup helpers in `lib/queries/` | 3 | Called by other queries, not page/endpoint-facing: `entityCodeToId`, `postedMetaForRawIds`, `inboxCounts`. *(If counted as reads, total = 96; `inboxCounts` is the most endpoint-worthy — `GET /inbox/counts`.)* |
| Action helpers | 2 | `actions/_authz.ts` (`requireRole`), `actions/_audit.ts` (audit logging). |
| Supabase client factories | 3 | `createClient` (server), `createDataClient` (data), `getAdminClient` (admin). |
| Admin-API auth plumbing | 1 | `lib/admin-api/token.ts` → `getAccessToken`. |

---

## 2. How to read this doc

- **Type:** `R` = read (query), `W` = write (mutation / RPC).
- **Current impl:** the actual exported function — `file.ts → fnName`. Names are verified exports, not idealized.
- **Role:** roles allowed to call it, enforced via `requireRole([...])` in `actions/_authz.ts`. Reads inherit **page-level** gating (`middleware.ts` + `<PageShell>` + `<RoleGate>`), not per-query checks.
- **Proposed REST:** the HTTP endpoint this becomes in a REST layer. These **do not exist yet** (except `POST /api/ai`).
- Roles: `coo`, `bookkeeper`, `cpa`, `admin` (matrix in [`lib/auth/permissions.ts`](../../lib/auth/permissions.ts)).

---

## 3. Resource groups

### 1. Auth & Users — 8 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| Sign in | W | `app/login/actions.ts → login` | email, password, next? | public | `POST /auth/login` |
| Sign out | W | `app/login/actions.ts → logout` | — | any | `POST /auth/logout` |
| List users | W | `app/(app)/admin/users/actions.ts → listUsers` | — | admin | `GET /users` |
| Create user | W | `…/admin/users/actions.ts → createUser` | email, password, role, displayName? | admin | `POST /users` |
| Update user role | W | `…/admin/users/actions.ts → updateUserRole` | userId, role | admin | `PATCH /users/:id/role` |
| Delete user | W | `…/admin/users/actions.ts → deleteUser` | userId | admin | `DELETE /users/:id` |
| Count admins | W | `app/no-role/actions.ts → countAdmins` | — | bootstrap (ungated) | `GET /admin/count` |
| Claim first admin | W | `app/no-role/actions.ts → claimFirstAdmin` | — | any auth, only if 0 admins | `POST /admin/claim-first` |

### 2. Transactions (raw + posted, classification) — 18 ops *(largest group)*
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| Unclassified bank | R | `lib/queries/transactions.ts → listUnclassifiedBank` | dateRange, entity | page-gated | `GET /transactions?side=bank&classified=false` |
| Classified bank | R | `…transactions.ts → listClassifiedBank` | dateRange, entity | page-gated | `GET /transactions?side=bank&classified=true` |
| Unclassified CC | R | `…transactions.ts → listUnclassifiedCC` | dateRange | page-gated | `GET /transactions?side=cc&classified=false` |
| Classified CC | R | `…transactions.ts → listClassifiedCC` | dateRange | page-gated | `GET /transactions?side=cc&classified=true` |
| Unclassified Admin-API | R | `…transactions.ts → listUnclassifiedAdminApi` | dateRange | page-gated | `GET /transactions?source=admin_api&classified=false` |
| Count unclassified (side) | R | `…transactions.ts → countUnclassifiedSide` | side | page-gated | `GET /transactions/count?side=` |
| Ledger view | R | `…transactions.ts → listLedgerView` | dateRange, entity | page-gated | `GET /ledger` |
| Txns for account | R | `…transactions.ts → listTxnsForAccount` | accountId, range | page-gated | `GET /accounts/:id/transactions` |
| Txns for account set | R | `…transactions.ts → listTxnsForAccountSet` | accountIds[], range | page-gated | `GET /accounts/transactions?ids=` |
| Classify one | W | `actions/transactions.ts → classifyTransaction` | rawId, accountId, entity | bookkeeper, admin | `POST /transactions/:id/classify` |
| Bulk classify | W | `…transactions.ts → bulkClassifyTransactions` | rawIds[], mapping | bookkeeper, admin | `POST /transactions/classify-bulk` |
| Split | W | `…transactions.ts → splitTransaction` | rawId, splits[] | bookkeeper, admin | `POST /transactions/:id/split` |
| Mark internal transfer | W | `…transactions.ts → markAsInternalTransfer` | rawId, counterAccountId | bookkeeper, admin | `POST /transactions/:id/internal-transfer` |
| Mark CC payment | W | `…transactions.ts → markAsCcPayment` | rawId, ccPaymentAccountId | bookkeeper, admin | `POST /transactions/:id/cc-payment` |
| Unfinalize | W | `…transactions.ts → unfinalizeTransaction` | txnId | bookkeeper, admin | `POST /transactions/:id/unfinalize` |
| Edit posted txn | W | `…transactions.ts → editTransaction` | id, fields | bookkeeper, admin | `PATCH /transactions/:id` |
| Edit raw txn date | W | `…transactions.ts → editRawTransactionDate` | rawId, newDate | bookkeeper, admin | `PATCH /transactions/:id/date` |
| Delete raw txn | W | `…transactions.ts → deleteRawTransaction` | rawId | bookkeeper, admin | `DELETE /transactions/:id` |

### 3. Classification Rules — 4 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List rules | R | `lib/queries/classify.ts → listClassificationRules` | — | page-gated | `GET /classification-rules` |
| Upsert rule | W | `actions/classify.ts → upsertClassificationRule` | id?, pattern, accountId, isActive | admin | `PUT /classification-rules/:id` |
| Delete rule | W | `actions/classify.ts → deleteClassificationRule` | id | admin | `DELETE /classification-rules/:id` |
| Apply rule (auto-tag) | W | `actions/classify.ts → bulkAutoTag` | ruleId, rawIds[] | bookkeeper, admin | `POST /classification-rules/:id/apply` |

### 4. Chart of Accounts — 6 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List accounts | R | `lib/queries/accounts.ts → listAccounts` | activeOnly? | page-gated | `GET /accounts` |
| Accounts w/ balances | R | `…accounts.ts → listAccountsWithBalances` | dateRange | page-gated | `GET /accounts/balances` |
| Create account | W | `actions/accounts.ts → createAccount` | code, name, type, subtype | bookkeeper, cpa, admin | `POST /accounts` |
| Update account | W | `actions/accounts.ts → updateAccount` | id, fields | bookkeeper, cpa, admin | `PATCH /accounts/:id` |
| Deactivate account | W | `actions/accounts.ts → deactivateAccount` | id | bookkeeper, cpa, admin | `POST /accounts/:id/deactivate` |
| Delete account | W | `actions/accounts.ts → deleteAccount` | id | bookkeeper, cpa, admin | `DELETE /accounts/:id` |

### 5. Journals & Period Close — 9 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List journals | R | `lib/queries/journals.ts → listJournals` | range, entity | page-gated | `GET /journals` |
| Journal w/ lines | R | `…journals.ts → getJournalWithLines` | id | page-gated | `GET /journals/:id` |
| List closed periods | R | `…journals.ts → listClosedPeriods` | — | page-gated | `GET /periods/closed` |
| JE-tagged txns | R | `…journals.ts → listJeTaggedTransactions` | range | page-gated | `GET /transactions?tagged=je` |
| Create journal | W | `actions/journals.ts → createJournal` | entries[], description, date | coo, bookkeeper, admin | `POST /journals` |
| Delete journal | W | `actions/journals.ts → deleteJournal` | id | coo, bookkeeper, admin | `DELETE /journals/:id` |
| Close month | W | `actions/journals.ts → closeMonth` | period, entity | coo, bookkeeper, admin | `POST /periods/close` |
| Reopen month | W | `actions/journals.ts → reopenMonth` | period, entity | coo, bookkeeper, admin | `POST /periods/reopen` |
| Close + adjustments | W | `actions/period-close.ts → closeMonthWithAdjustments` | period, adjustments[] | coo, bookkeeper, admin | `POST /periods/close-with-adjustments` |

### 6. Invoices & AP — 7 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List invoices | R | `lib/queries/invoices.ts → listInvoices` | status? | page-gated | `GET /invoices?status=` |
| List open invoices | R | `…invoices.ts → listOpenInvoices` | — | page-gated | `GET /invoices?status=open` |
| List open AP items | R | `lib/queries/ap.ts → listOpenApItems` | entity | page-gated | `GET /ap/items` |
| Create invoice | W | `actions/invoices.ts → createInvoice` | vendorId, number, dates, amount | coo, bookkeeper, admin | `POST /invoices` |
| Record payment | W | `actions/invoices.ts → recordPayment` | invoiceId, amountPaid | coo, bookkeeper, admin | `POST /invoices/:id/payments` |
| Delete invoice | W | `actions/invoices.ts → deleteInvoice` | id | coo, bookkeeper, admin | `DELETE /invoices/:id` |
| Pay AP item | W | `actions/ap.ts → payApItem` | apItemId, … | coo, cpa, admin | `POST /ap/items/:id/pay` |

### 7. Vendors — 6 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List vendors | R | `lib/queries/vendors.ts → listVendors` | — | page-gated | `GET /vendors` |
| Get vendor | R | `…vendors.ts → getVendor` | id | page-gated | `GET /vendors/:id` |
| Top vendors by YTD | R | `…vendors.ts → listTopVendorsByYtdSpend` | limit | page-gated | `GET /vendors/top` |
| Create vendor | W | `actions/vendors.ts → createVendor` | name, email?, phone? | coo, bookkeeper, admin | `POST /vendors` |
| Update vendor | W | `actions/vendors.ts → updateVendor` | id, fields | coo, bookkeeper, admin | `PATCH /vendors/:id` |
| Delete vendor | W | `actions/vendors.ts → deleteVendor` | id | coo, bookkeeper, admin | `DELETE /vendors/:id` |

### 8. Reconciliation — 4 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List matches | R | `lib/queries/reconcile.ts → listReconciliationMatches` | range | page-gated | `GET /reconciliation/matches` |
| Mark matched | W | `actions/reconcile.ts → markMatched` | statementTxnId, bookTxnId | coo, bookkeeper, admin | `POST /reconciliation/match` |
| Auto-match period | W | `actions/reconcile.ts → autoMatchPeriod` | period, tolerance | coo, bookkeeper, admin | `POST /reconciliation/auto-match` |
| Unmatch | W | `actions/reconcile.ts → unmatch` | statementTxnId | coo, bookkeeper, admin | `DELETE /reconciliation/matches/:id` |

### 9. Cash Balances — 2 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List cash balances | R | `lib/queries/cash.ts → listCashBalances` | — | page-gated | `GET /cash-balances` |
| Save cash balance | W | `actions/cash.ts → saveCashBalance` | colKey, value | coo, bookkeeper, cpa, admin | `PUT /cash-balances` |

### 10. Bank Connections — 4 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List connections | R | `lib/queries/cash.ts → listBankConnections` | — | page-gated | `GET /banks` |
| Create connection | W | `actions/banks.ts → createBankConnection` | bankCode, token | coo, admin | `POST /banks` |
| Update connection | W | `actions/banks.ts → updateBankConnection` | id, fields | coo, admin | `PATCH /banks/:id` |
| Delete connection | W | `actions/banks.ts → deleteBankConnection` | id | coo, admin | `DELETE /banks/:id` |

### 11. Cashbook (Admin-API snapshots) — 4 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| Latest snapshots | R | `lib/queries/cashbook.ts → getLatestSnapshots` | range | page-gated | `GET /cashbook/snapshots` |
| Refresh snapshot | W | `actions/cashbook.ts → refreshCashbookSnapshot` | range | coo, cpa, admin | `POST /cashbook/refresh` |
| Generate journals | W | `actions/cashbook.ts → generateCashbookJournals` | period | coo, cpa, admin | `POST /cashbook/generate-journals` |
| Delete Admin-API txns | W | `actions/cashbook.ts → deleteAdminApiTransactions` | — | coo, cpa, admin | `DELETE /cashbook/admin-api-transactions` |

### 12. Reports (P&L / Balance Sheet / Cash Flow / Dashboard / Ratios / Product Mix / Forecast) — 5 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| Report data (generic) | R | `lib/queries/reports.ts → fetchReportData` | period, entity | page-gated | `GET /reports/data` |
| P&L report data | R | `…reports.ts → fetchPnlReportData` | period, entity | page-gated | `GET /reports/pnl` |
| Balance sheet data | R | `…reports.ts → fetchBalanceSheetData` | asOf, entity | page-gated | `GET /reports/balance-sheet` |
| Drill-down account | W | `actions/reports.ts → drillDownAccount` | accountId, period | ⚠ any authenticated | `POST /reports/drill-down` |
| Drill-down account set | W | `actions/reports.ts → drillDownAccountSet` | accountIds[], period | ⚠ any authenticated | `POST /reports/drill-down-set` |

> **Derived-only pages:** `cashflow`, `ratios`, `dashboard`, `productmix`, `forecast` have **no dedicated query fn** — they compute in-page from `fetchReportData` + the 9 compute helpers. To REST-ify, add: `GET /reports/cashflow`, `/reports/ratios`, `/reports/dashboard`, `/reports/product-mix`, `/reports/forecast`.

### 13. P&L Manual Entries — 3 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List manual entries | R | `lib/queries/pnl-manual.ts → listPnlManualEntries` | range | page-gated | `GET /pnl/manual-entries` |
| Upsert manual entry | W | `actions/pnl-manual.ts → upsertPnlManualEntry` | accountId, entity, period, amount | ⚠ **no role gate found** | `PUT /pnl/manual-entries` |
| Delete manual entry | W | `actions/pnl-manual.ts → deletePnlManualEntry` | id | ⚠ **no role gate found** | `DELETE /pnl/manual-entries/:id` |

### 14. Sales — 1 op
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| Revenue txns | R | `lib/queries/sales.ts → listRevenue` | period, entity | page-gated | `GET /sales/revenue` |

### 15. CFO Notes — 4 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| List notes | R | `lib/queries/notes.ts → listCfoNotes` | — | page-gated | `GET /cfo-notes` |
| Create note | W | `actions/cfnotes.ts → createCfoNote` | text, tags? | coo, cpa, admin | `POST /cfo-notes` |
| Update note | W | `actions/cfnotes.ts → updateCfoNote` | id, text, tags? | coo, cpa, admin | `PATCH /cfo-notes/:id` |
| Delete note | W | `actions/cfnotes.ts → deleteCfoNote` | id | coo, cpa, admin | `DELETE /cfo-notes/:id` |

### 16. Import / Entities / AI / External — 8 ops
| Operation | Type | Current impl | Inputs | Role | Proposed REST |
|---|:--:|---|---|---|---|
| Preview import | W | `actions/import.ts → previewImport` | file, format?, entity? | bookkeeper, admin | `POST /import/preview` |
| Commit import | W | `actions/import.ts → commitImport` | parsedRows[], mapping | bookkeeper, admin | `POST /import/commit` |
| Delete all transactions | W | `actions/import.ts → deleteAllTransactions` | — | admin | `DELETE /transactions/all` |
| Delete all financial data | W | `actions/import.ts → deleteAllFinancialData` | — | admin | `DELETE /financial-data/all` |
| List entities | R | `lib/queries/entities.ts → listEntities` | — | page-gated | `GET /entities` |
| Payment-method report | R (ext) | `lib/admin-api/reports.ts → fetchPaymentMethodReport` | range | server-to-server | `GET /admin-api/payment-methods` |
| Sales summary (live) | R (ext) | `lib/admin-api/reports.ts → fetchSalesSummaryLive` | range | server-to-server | `GET /admin-api/sales-summary` |
| **AI advisor** ✅ | W | `app/api/ai/route.ts` (**exists**) | message, history | coo (rate-limited 20/min) | `POST /api/ai` |

---

## 4. Data model appendix

Supabase tables touched by the operations above (authz enforced in app layer — **RLS not yet enabled**):

| Table | Used by | Notes |
|---|---|---|
| `raw_transactions` | Transactions, Import, Reconcile | Unclassified bank/CC/Admin-API rows; `classified` flag |
| `transactions` | most reports, Ledger, Classify | Posted GL rows; `checksum`, `memo` (`je:` tags) |
| `transactions_pnl` (view) | P&L, Dashboard | Deduped Admin-API snapshot view |
| `accounts` | COA, all reports | Chart of accounts; `account_type/subtype`, `is_active` |
| `pnl_manual_entries` | P&L, Dashboard | Manual adjustments per account/entity/month |
| `journal_entries`, `ledger_entries` | Journals | Double-entry headers + lines; DRAFT/POSTED |
| `closed_periods` | Period close | Period lock metadata |
| `invoices` | Invoices, Dashboard | AP invoices; `amount_paid`, `status` |
| `ap_items` | AP | Aging buckets |
| `vendors` | Vendors, AI context | Master + YTD spend |
| `bank_connections` | Banks, Inboxes | Linked accounts, last sync |
| `cash_balances` | Cash Balances, Forecast, AI | Manual cash/payables snapshot |
| `cashbook_snapshots` | Cashbook | Admin-API payment-method snapshots |
| `classification_rules` | Rules, Inboxes | Pattern → account auto-tagging |
| `reconciliation_matches` | Reconcile | Bank-to-book matches |
| `cfo_notes` | CFO Notes | Free-form notes |
| `entities` | global | Multi-entity master (WBP, LP, KP, …) |
| `profiles` / `auth.users` | Auth & Users | role (`coo`/`bookkeeper`/`cpa`/`admin`), display_name |
| `audit_log` | all writes | Written by `actions/_audit.ts` |

---

## 5. Gaps & notes

1. **Only 1 real HTTP endpoint exists** (`POST /api/ai`). Everything else is a Server Action, callable only from this Next.js app — **not** by a mobile app or external client. A true REST layer means building the ~80 endpoints above.
2. **⚠ Authorization gaps found:**
   - `actions/pnl-manual.ts` (`upsertPnlManualEntry`, `deletePnlManualEntry`) — **no `requireRole` gate**. Any authenticated user can write manual P&L adjustments. Likely a bug.
   - `actions/reports.ts` (`drillDownAccount`, `drillDownAccountSet`) — only checks `getCurrentProfile()` (authenticated), **no role restriction**.
3. **Derived-only report pages** (`cashflow`, `ratios`, `dashboard`, `productmix`, `forecast`) have no dedicated backend fn — they compute from `fetchReportData`. A REST layer needs 5 new computed endpoints.
4. **No RLS** — all authz is app-layer (`middleware.ts` + `<PageShell>` + `<RoleGate>` + per-action `requireRole`). A REST layer must re-enforce role checks at every endpoint, and **reads currently have no per-query gate** (only page-level).
5. **Legacy parity gaps** (present in `legacy/`, absent in new app): Google-Sheets sync (cash balances / P&L comparison / product-mix data) and the AP "dispute note" action have no Server Action equivalent yet.
6. **Internal helpers excluded from the count** (see §1 methodology): 9 compute helpers + 3 DB-lookup helpers in `lib/queries/`, plus `_authz`/`_audit`, the 3 Supabase client factories, and `lib/admin-api/token.ts`.

---

### Count reconciliation
`57` actions + `33` reads + `2` admin-api reads + `1` route = **93 backend operations** → **~80 normalized REST endpoints**.
