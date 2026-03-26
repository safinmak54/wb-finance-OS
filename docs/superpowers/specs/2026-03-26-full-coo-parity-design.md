# WB Finance OS — Full COO Parity Design

**Date:** 2026-03-26
**Approach:** Sprint Sequence (A) — Foundation → Report Depth → New Tabs
**Scope:** Three independent sprints, each QA-able on its own

---

## Context

The COO's reference dashboard (`bookkeeping_suite.html`) is the gold standard for what the WB Financial dashboard should look and feel like. This spec captures everything needed to reach full parity across all 17 tabs, plus an admin role that sees every page.

Stack: Pure HTML/CSS/JS (no build step). Data from Supabase REST API + hardcoded seed. Charts via Chart.js 4.4.1.

---

## Sprint 1 — Foundation

### 1.1 Admin Role

Add a 4th entry to the `ROLES` constant in `app.js`:

```js
admin: {
  label: 'Admin',
  color: '#7C3AED',
  pages: ['dashboard','transactions','journals','pl','balance-sheet','cash-flow',
          'ratios','cfo-notes','ap','reconciliation','sales','product-mix',
          'cash-forecast','invoices','rules','settings','import']
}
```

- Login screen: add a 4th tile — **Admin** / `wb-admin-2026` with purple accent
- Every sidebar `data-roles` attribute gets `admin` appended
- Admin nav badge shows a purple pill label

### 1.2 Global Sticky Filter Bar

A new `<div id="globalFilterBar">` inserted between the topbar and `#main-content`. Visible on all pages except Settings, Rules, and Import.

**HTML structure:**
```html
<div id="globalFilterBar">
  <div class="gfb-periods">
    <button class="gfb-btn active" data-period="month">This Month</button>
    <button class="gfb-btn" data-period="last-month">Last Month</button>
    <button class="gfb-btn" data-period="qtd">QTD</button>
    <button class="gfb-btn" data-period="ytd">YTD</button>
    <button class="gfb-btn" data-period="custom">Custom ▾</button>
  </div>
  <select id="gfbEntitySel" onchange="app.onGlobalFilterChange()">
    <option value="all">All Entities</option>
    <!-- entity options -->
  </select>
  <div id="gfbChips" class="gfb-chips"></div>
</div>
```

**JS:** `state.globalPeriod` and `state.globalEntity` are set by the filter bar. All existing `fetchReportData()` calls read from these state keys instead of local variables. `onGlobalFilterChange()` re-renders the active page.

**CSS:** sticky below topbar (`position: sticky; top: 56px; z-index: 90`), 48px height, border-bottom separating it from page content.

### 1.3 Topbar KPI Pills

Two `<span>` elements injected into the topbar right section (next to dark mode toggle):

- **Bank:** sum of `window._bankAccounts[].balance` formatted as `$1.25M`
- **Net:** bank minus `window._ccPayables` formatted as `$694K`, red if negative

Updated on login and on `onGlobalFilterChange()` when entity changes.

### 1.4 Import Modal

A `<dialog id="importModal">` triggered by the existing Import nav item.

**Features:**
- Drag-drop zone + `<input type="file">` accepting `.xlsx`, `.csv`, `.qbo`
- SheetJS (CDN) for Excel parsing; native `FileReader` for CSV
- Column mapping UI: detected headers → `transactions` schema fields
- 10-row preview table before commit
- Bulk insert to Supabase `transactions` via REST POST
- Progress bar + success/error toast

---

## Sprint 2 — Report Depth

### 2.1 P&L — 5 View Modes

Tab strip above the P&L table: `Summary | Detail | By Entity | vs Prior Year | vs Budget`

| Mode | Columns |
|------|---------|
| Summary | Category · Amount · % Revenue |
| Detail | Category · Sub-category · Amount · % |
| By Entity | Category · WBP · LP · KP · BP · SWAG · RUSH · Total |
| vs Prior Year | Category · Current · Prior Yr · $ Var · % Var |
| vs Budget | Category · Actual · Budget · $ Var · % Var |

**Charts added below table:**
1. **Waterfall** — Revenue → COGS → Gross Profit → OpEx → Net Income
2. **Margin Trend** — 12-month rolling net margin % (line chart)

Prior year and budget data sourced from `window._plData` seed (extended) or a new `pl_budget` Supabase table if available.

### 2.2 Balance Sheet — 2-Column Layout

Split `#page-balance-sheet` into a CSS grid: Assets (left) / Liabilities + Equity (right), rendered side by side.

**Additions:**
- 3 ratio cards above the table: **Current Ratio**, **Debt-to-Equity**, **Quick Ratio** (calculated from BS line items)
- **Retained Earnings Waterfall** chart: Prior RE → Net Income → Distributions → Current RE

### 2.3 Cash Flow — GAAP 3-Statement

Restructure `#page-cash-flow` into 3 collapsible `<details>` sections:

1. **Operating Activities** — net income + non-cash adjustments + working capital changes
2. **Investing Activities** — CapEx, asset purchases/sales
3. **Financing Activities** — loan proceeds/repayments, owner distributions

Footer: **Net Change in Cash** and **Ending Cash Balance** (tied to `_bankAccounts` total).

### 2.4 Ratios — Charts Upgrade

Three new Chart.js visualizations on the ratios page:

1. **EBITDA Bridge** — waterfall: EBIT → D&A add-back → EBITDA
2. **Budget vs Actual** — horizontal bar chart, top 8 cost categories
3. **Margin Trend** — 3-line chart (Gross / Operating / Net margin), 12 months

---

## Sprint 3 — New & Enhanced Tabs

### 3.1 AP/Payables (new tab — Supabase)

**New Supabase table: `ap_items`**

```sql
create table ap_items (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  vendor text not null,
  invoice_date date,
  due_date date,
  amount numeric(12,2),
  paid boolean default false,
  aging_bucket text, -- 'current','1-30','31-60','61-90','90+'
  created_at timestamptz default now()
);
```

**Tab UI:**
- KPI row: Total Outstanding | Overdue | Due This Week | Avg Days to Pay
- Aging summary bar (5 buckets, color-coded)
- Full data table with **Pay** (sets `paid=true`) and **Dispute** action buttons
- Filter by entity, vendor, aging bucket

### 3.2 Reconciliation (new tab — Supabase)

**New Supabase table: `reconciliation_matches`**

```sql
create table reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  statement_txn_id uuid references raw_transactions(id),
  book_txn_id uuid references transactions(id),
  entity text,
  amount numeric(12,2),
  match_status text default 'pending', -- 'matched','unmatched','pending','disputed'
  matched_at timestamptz,
  created_at timestamptz default now()
);
```

**Tab UI:**
- Summary cards: Matched | Unmatched | Pending Review
- Two-column view: Bank Statement (left) vs Book Transactions (right)
- **Auto-match** button — JS fuzzy match on amount + date ± 3 days, writes results to Supabase
- **Manual match** — click to link unmatched rows on each side; saves to `reconciliation_matches`

### 3.3 CFO Notes — 6 Formal Notes

**Executive banner** at top: entity name, reporting period, "Prepared by: Finance Team", disclaimer.

**Six note cards** (rich-text, `contenteditable`, auto-saved to `localStorage` keyed by `entity+period`):

1. Revenue Recognition
2. Significant Transactions
3. Contingent Liabilities
4. Related Party Transactions
5. Subsequent Events
6. Going Concern / Liquidity

**Print/Export** button: `window.print()` with a print-specific CSS that hides nav and shows notes full-width.

### 3.4 Sales

- **Live revenue banner** — current month total (large, top of page)
- **Weekly bar chart** — 7-day rolling revenue (Chart.js bar)
- **Monthly performance table** — MTD vs prior month vs budget, % variance columns

### 3.5 Product Mix

- **Today's KPIs** — units sold, AOV, top SKU (from `window._productMix` seed)
- **Ad platform breakdown** — Meta / Google / TikTok spend vs revenue (grouped bar chart)
- **Channel mix donut** — revenue share by channel

### 3.6 Cash Forecast

- Editable monthly 2026 table: rows = revenue/expense categories, columns = Jan–Dec
- Cells are `contenteditable` with auto-sum footer row
- **Forecast vs Actual** delta column for completed months (amber if over by >10%)
- Saves to `localStorage` keyed by entity

### 3.7 Invoices — AR Aging

Add to existing invoices table:
- **Age (days)** column — calculated from `due_date` vs today
- **Aging Bucket** column — Current / 30 / 60 / 90+ (color-coded chip)

Add aging summary grid above the table:
| Current | 1–30 Days | 31–60 Days | 61–90 Days | 90+ Days |
showing totals per bucket, clickable to filter the table.

---

## Data & State

| State key | Type | Set by |
|-----------|------|--------|
| `state.globalPeriod` | string | Global filter bar |
| `state.globalEntity` | string | Global filter bar |
| `state.currentEntity` | string | (existing, aliased to globalEntity) |
| `state.currentPeriod` | string | (existing, aliased to globalPeriod) |

All report fetch functions (`fetchReportData`, `fetchPL`, `fetchBS`, etc.) read `state.globalPeriod` and `state.globalEntity` as their primary inputs.

---

## File Impacts

| File | Changes |
|------|---------|
| [index.html](index.html) | Admin login tile, `#globalFilterBar`, topbar pills, AP tab, Reconciliation tab, 5 P&L mode tabs, BS 2-col layout, CF 3-section, import modal dialog |
| [app.js](app.js) | `ROLES.admin`, `onGlobalFilterChange()`, topbar pill update, `updatePL(mode)`, `updateBS()` with ratios, `updateCashFlow()` 3-section, new chart functions, AP/Recon Supabase fetch+render, CFO notes autosave, Sales/ProductMix/Forecast/Invoice upgrades, SheetJS import logic |
| [styles.css](styles.css) | `#globalFilterBar` sticky styles, `.gfb-btn`, `.gfb-chips`, `.pl-mode-tabs`, `.two-col-bs`, `.aging-grid`, `.ap-kpi-row`, `.recon-split`, `.cfr-note-card`, print styles |

---

## Verification Checklist

- [ ] Admin login with `wb-admin-2026` shows all 17 sidebar items
- [ ] Global filter bar sticks below topbar; changing period re-renders active page
- [ ] Topbar shows Bank/Net pills updated by entity filter
- [ ] Import modal accepts `.xlsx` and `.csv`, shows 10-row preview, inserts to Supabase
- [ ] P&L has 5 mode tabs; each renders correct columns; waterfall + margin trend charts render
- [ ] Balance Sheet shows 2-column layout with 3 ratio cards and RE waterfall chart
- [ ] Cash Flow shows 3 collapsible GAAP sections with net change footer
- [ ] Ratios page has EBITDA bridge, budget vs actual, and margin trend charts
- [ ] AP tab fetches from Supabase `ap_items`; Pay button updates `paid` flag
- [ ] Reconciliation tab auto-match writes to `reconciliation_matches`; manual match works
- [ ] CFO Notes shows 6 cards; edits persist across page navigations via localStorage
- [ ] Sales shows live banner, weekly chart, monthly table
- [ ] Product Mix shows today KPIs, ad platform chart, channel donut
- [ ] Cash Forecast editable cells auto-sum; saves to localStorage
- [ ] Invoices table has Age and Aging Bucket columns; aging summary grid filters on click
- [ ] Dark mode: all new components respect `[data-theme="dark"]` CSS overrides
