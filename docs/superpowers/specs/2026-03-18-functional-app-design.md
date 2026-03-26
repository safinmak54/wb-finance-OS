# WB Finance OS — Functional App Design

**Date:** 2026-03-18
**Status:** Approved

## Overview

Transform the WB Finance OS dashboard from a hardcoded demo into a fully functional multi-entity accounting system backed by Supabase. The build is decomposed into four independent phases, each producing testable, working software before the next begins.

---

## Phase Breakdown

| Phase | Goal | Testable Output |
|-------|------|----------------|
| **1 — Foundation** | Fix Supabase connection, clear sample data, create `transactions` table, remove all hardcoded data fallbacks | App loads live from Supabase with empty state |
| **2 — Transaction Workflow** | Inbox (upload/classify), Ledger (view/edit classified) | QA can upload CSV, classify transactions, view in ledger |
| **3 — Reports** | P&L + Balance Sheet built dynamically from real transaction data | Reports update live as transactions are classified |
| **4 — Month-end Close** | Cash entry (fixed), accrual entry (manual), mandatory adjusting entry | User can close a month, confirm adjusting entries, finalize statements |

---

## Current Codebase State

- **Stack:** Pure HTML/CSS/JS — `index.html`, `styles.css`, `app.js` (1,742 lines)
- **Supabase:** Project exists at `https://fxwjadkbvlvxtxxkjqkw.supabase.co`
- **Bug:** URL in `app.js` line 9 reads `supabaseClient.co` instead of `supabase.co` — connection is currently broken
- **Data:** All tables seeded with sample data (20 raw_transactions, 43 accounts, 6 entities, 10 vendors, 7 invoices, 3 journal_entries)
- **Missing table:** `transactions` does not exist — only `raw_transactions`

---

## Data Model

### `transactions` table (CREATE NEW)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | primary key, default gen_random_uuid() |
| `raw_transaction_id` | uuid | FK → raw_transactions.id, UNIQUE (nullable — manual entries have no raw source; unique prevents duplicate classification) |
| `entity` | text | WB, LP, KP, BP, WBP, ONEOPS |
| `account_id` | uuid | FK → accounts.id (COA category) |
| `amount` | numeric(12,2) | Signed amount using cash-flow convention: positive = money in (revenue, asset increase), negative = money out (expense, liability increase). Reports apply this directly — no debit/credit inversion needed. The `accounts.normal_balance` column is used for COA display only, not for transaction math. |
| `txn_date` | date | date of transaction |
| `acc_date` | date | accounting period date (controls which P&L period it appears in) |
| `description` | text | |
| `memo` | text | optional user note |
| `created_at` | timestamptz | default now() |

**Amount sign convention (important):** This app uses simplified single-entry cash-flow convention, not double-entry debits/credits. All report calculations use `SUM(amount)` directly:
- Revenue accounts: positive amounts sum to revenue
- Expense accounts: negative amounts sum to expenses (displayed as absolute value)
- Asset accounts: positive = asset increase, negative = asset decrease
- Liability/equity accounts: negative = liability/equity increase (money owed out)

### `raw_transactions` table (ALTER — add columns)

| New Column | Type | Notes |
|------------|------|-------|
| `classified` | boolean | default false — true once moved to transactions |
| `classified_at` | timestamptz | timestamp of classification |

### `journal_entries` table (ALTER — add columns)

| New Column | Type | Notes |
|------------|------|-------|
| `entry_type` | text | `manual` \| `accrual` \| `cash` \| `adjusting` |
| `period` | text | YYYY-MM format — ties entry to a close month |

### `journal_entries` table (existing schema — documented for reference)

Existing columns: `id` (uuid), `memo` (text), `account` (text — account code), `debit` (numeric), `credit` (numeric), `date` (date), `entity` (text), `type` (text).

New columns added in Phase 1: `entry_type` (`manual`|`accrual`|`cash`|`adjusting`), `period` (text YYYY-MM).

**P&L integration:** Journal entries are included in P&L by looking up the account code in `accounts` to get `account_type`, then applying: `debit − credit` as the net amount for that account line. The `period` column (YYYY-MM) is used to filter journal entries to the same month as the P&L's `acc_date` period filter.

### `closed_periods` table (CREATE NEW)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | primary key |
| `period` | text | YYYY-MM, UNIQUE |
| `entity` | text | entity code, or 'all' for consolidated close |
| `closed_at` | timestamptz | when the period was closed |
| `closed_by` | text | user identifier (optional) |

Enforcement: when inserting into `transactions`, the app checks `closed_periods` for the `acc_date` period. If a match exists, the insert is rejected with a user-facing error. Supabase RLS can enforce this at the DB level in a future phase; for now it is enforced in app logic.

### `accounts` table (no changes)

Already has `account_code`, `account_name`, `account_type`, `account_subtype`, `normal_balance`, `line`, `is_active`.

---

## Phase 1 — Foundation

### Goals
1. Fix Supabase URL typo (`supabaseClient.co` → `supabase.co`)
2. Clear all sample data from all tables
3. Create `transactions` table with schema above
4. Alter `raw_transactions` and `journal_entries` tables
5. Remove hardcoded data fallback — app must always use Supabase
6. Remove all Stripe-specific references from UI (hardcoded revenue, fake bank balances, Stripe payouts)
7. Dashboard KPIs load from real aggregates (zero state if no data)

### Out of scope for Phase 1
- CSV upload (Phase 2)
- Report logic (Phase 3)

---

## Phase 2 — Transaction Workflow

### Inbox Page (replaces "Transactions" in sidebar)

**Purpose:** Classify unclassified raw transactions into the ledger.

**Data source:** `raw_transactions WHERE classified = false`

**Features:**
- List view: date, description, amount, source (bank/CSV/manual), entity
- Per-row actions:
  - Searchable COA account dropdown (account_code + account_name)
  - Entity selector (if not auto-detected)
  - Classify button — writes to `transactions`, sets `raw_transactions.classified = true`
- Bulk classify — checkbox multi-select, assign same category to all selected, classify
- **CSV Upload** — accepts bank export CSV/XLS/XLSX via existing XLSX library. Column mapping: app attempts auto-detection by matching common header variants (`Date`/`Transaction Date`/`Posted Date` → txn_date; `Description`/`Memo`/`Payee` → description; `Amount`/`Debit`/`Credit` → amount). If auto-detection confidence is low or columns are ambiguous (e.g., separate Debit/Credit columns), a mapping UI is shown before import — user selects which CSV column maps to each required field. On success, rows land in `raw_transactions` with `classified = false`.
- **Manual Entry** — form to add a single transaction directly to `raw_transactions`
- **+ New Account** — inline form to create a new COA account on the fly (account_code, account_name, account_type, account_subtype); saves to `accounts` table, immediately available in dropdown

### Ledger Page (new page in sidebar)

**Purpose:** View and edit all classified transactions.

**Data source:** `transactions` table joined with `accounts`

**Features:**
- Filterable by: entity, period (month), account/category, amount range
- Sortable columns: date, description, amount, category
- Per-row **Edit** — opens modal to change account_id, memo, txn_date, acc_date
- Editing updates `transactions` row only — does not touch `raw_transactions`
- Pagination (15 rows per page)

---

## Phase 3 — Reports

### P&L

**Data source:** `transactions` + `journal_entries` filtered by `acc_date` period and entity.

**Structure:**

```
Gross Revenue
  [revenue accounts grouped by account line]
  Total Revenue

Cost of Goods Sold
  [cogs accounts grouped by account line]
  Gross Profit / Gross Margin %

Operating Expenses
  [expense accounts grouped by account_subtype]
  Total Operating Expenses

Net Operating Income

Adjusting Entries (Phase 4)
  [journal_entries WHERE entry_type = 'adjusting' AND period = current]

Net Profit / Net Margin %
```

**Behavior:**
- Period picker controls `acc_date` range
- Entity filter narrows or consolidates
- No hardcoded scaling factors — uses actual transaction amounts
- Updates live as transactions are classified in Inbox

### Balance Sheet

**Data source:** `transactions` cumulative (all time, not period-filtered) + `journal_entries`.

**Structure:**
```
Assets
  Current Assets: [asset/current accounts]
  Total Assets

Liabilities
  Current Liabilities: [liability accounts]
  Total Liabilities

Equity
  [equity accounts]
  Net Profit (current period)
  Total Equity

Liabilities + Equity = Total Assets (validation line)
```

---

## Phase 4 — Month-end Close

### Entry Types

| Type | Source | Editable |
|------|--------|----------|
| `cash` | Sum of classified transactions for the period | No — derived from ledger |
| `accrual` | Manual journal entry — what was earned/owed per accrual basis | Yes |
| `adjusting` | `accrual amount − cash amount` | Mandatory confirmation — system calculates |

### Close Workflow

1. User navigates to Journal Entries → clicks **"Close Month"** for a given YYYY-MM period
2. System shows summary:
   - Total cash received/paid (from `transactions` for that period)
   - Total accrued (from existing `journal_entries WHERE entry_type = 'accrual' AND period = X`)
3. User enters accrual amounts for Revenue and COGS lines
4. System calculates adjusting entry: `accrual − cash` per line
5. User must review and **confirm** the adjusting entry — cannot skip
6. On confirm: adjusting entries posted to `journal_entries` with `entry_type = 'adjusting'`
7. Period marked as closed: insert row into `closed_periods` table — no further classification into that period is allowed (enforced in app logic on classify/save)

### P&L Display (Phase 4 addition)

P&L gains a dual-view for closed months:
- **Cash basis** — from transactions only
- **Accrual basis** — cash + adjusting entries
- **Delta line** — difference per section

---

## Navigation Changes

| Section | Before | After |
|---------|--------|-------|
| Accounting | Transactions, Journal Entries, Reconciliation | **Inbox**, **Ledger**, Journal Entries, Reconciliation |
| Reports | P&L, Balance Sheet, Cash Flow | P&L (dynamic), Balance Sheet (dynamic), Cash Flow |
| Everything else | Vendors, Invoices, COA, Banks | Unchanged |

---

## Out of Scope (Phase 2 — future)

- Live bank sync / Plaid integration
- Admin portal data pull (Gross Revenue live feed)
- Multi-user permissions / RLS policies beyond basic anon key

---

## Key Technical Notes

- `app.js` currently has Supabase as optional with hardcoded fallback. Phase 1 removes the fallback entirely — Supabase is required.
- The Supabase anon key is currently embedded in `app.js`. This is acceptable for a private internal tool but should move to environment config before any public exposure.
- CSV import uses the existing XLSX library already loaded in `index.html`.
- All new DB operations follow the existing pattern: `supabaseClient.from('table').select/insert/update`.
