# WB Brands Finance OS

Multi-entity financial dashboard for WB Brands and subsidiaries. Accrual-basis accounting with bank CSV import, auto-classification, journal entries, and full P&L/Balance Sheet reporting.

## Stack

- **Frontend**: Pure HTML / CSS / JavaScript (no framework, no build step)
- **Database**: [Supabase](https://supabase.com) (PostgreSQL via REST API)
- **Hosting**: [Vercel](https://vercel.com) (static deployment)
- **Fonts**: DM Sans + DM Mono (Google Fonts)

## Files

| File | Purpose |
|------|---------|
| `index.html` | UI structure, sidebar, modals, pages |
| `styles.css` | All styling, themes (light/dark), responsive |
| `app.js` | All application logic, data loading, rendering |

## How to Run

**Locally**: Open `index.html` in a browser. Connects to the production Supabase database by default.

**Vercel**:
- Production: `wb-company.vercel.app` (auto-deploys from `main` branch)
- QA: Any other Vercel preview URL (auto-deploys from `qa` branch, uses separate QA database)

The environment is auto-detected by hostname. QA shows an orange "QA ENVIRONMENT" banner.

## Environments

| Environment | Supabase Project | Branch |
|-------------|-----------------|--------|
| Production | `fxwjadkbvlvxtxxkjqkw` | `main` |
| QA | `jvemtsgnrfzmmbuwmmrj` | `qa` |

QA has its own isolated database. Changes in QA do not affect production data.

## Entities

| Code | Entity |
|------|--------|
| WB | WB Brands LLC |
| WBP | WB Promo LLC |
| LP | Lanyard Promo LLC |
| KP | Koolers Promo LLC |
| BP | Band Promo LLC |
| SP1 | SP Brands LLC |
| ONEOPS | One Operations Management LLC |
| WB-ALL | Consolidated (all entities) |

## Features

### Accounting
- **Bank Transactions**: Import CSV/BAI bank statements, auto-detect entity and direction
- **Credit Card Transactions**: Import CC statements (Capital One, Amex, Chase formats)
- **Auto-Classification Rules**: Pattern-based rules auto-tag transactions to accounts
- **Finalize to Ledger**: Batch-classify transactions with entity + account
- **Journal Entries**: Create manual entries with date, description, entity, account, amount
- **Transaction Splitting**: Split a bank transaction across months for accrual accounting
- **Untag**: Move classified transactions back to inbox or mark journal entries as Draft

### Reports
- **Profit & Loss**: Collapsible sections (Revenue, COGS, Marketing, Operating Expenses), drill-down per account, inline JE editing
- **Balance Sheet**: Assets, liabilities, equity with retained earnings waterfall
- **Cash Flow**: Operating, investing, financing sections
- **Ratios & KPIs**: Current ratio, quick ratio, DSO, DPO, working capital
- **Sales Metrics**: Live revenue from Supabase + Google Sheets sync

### Other
- **Cash Balances**: Manual entry or Google Sheets sync (supports non-standard sheet layouts)
- **Cash Forecast**: Weekly actuals vs projections
- **Vendors & Invoices**: AP tracking
- **Reconciliation**: Bank reconciliation tools
- **Clear All Data**: Resets all tables except classification rules

## Data Flow

```
CSV/BAI Upload
    |
    v
raw_transactions (inbox)
    |
    |-- Classify --> transactions (ledger) --> P&L, Balance Sheet, Cash Flow
    |
    |-- Split ✂ --> transactions (2 parts, different dates/amounts)
    |
    |-- Auto-Tag --> Rules match description → pre-select account

Journal Entries
    |
    v
journal_entries + ledger_entries + transactions --> P&L
    |
    |-- Untag --> Draft (editable, re-postable)
    |-- Delete --> Removes from all tables
```

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `entities` | Company entities with codes |
| `accounts` | Chart of accounts (code, name, type, subtype) |
| `raw_transactions` | Imported bank/CC transactions (inbox) |
| `transactions` | Classified transactions (ledger, P&L source) |
| `journal_entries` | Manual journal entries |
| `ledger_entries` | Journal entry line items (debit/credit) |
| `classification_rules` | Auto-tag rules (pattern → account) |
| `cash_balances` | Cash position per entity |
| `closed_periods` | Month-close tracking |
| `vendors` | Vendor directory |
| `invoices` | Invoice tracking |
| `ap_items` | Accounts payable items |

## Roles

| Role | Login Code | Access |
|------|-----------|--------|
| COO | `wb-coo-2026` | Full access |
| Bookkeeper | `wb-books-2026` | Accounting pages |
| CPA | `wb-cpa-2026` | Reports only |

## RLS (Row Level Security)

All tables have RLS enabled with `anon_full_access` policy for the anon key. For production security, replace with authenticated policies when adding real user auth.
