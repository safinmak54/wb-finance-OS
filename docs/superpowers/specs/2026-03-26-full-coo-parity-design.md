# WB Finance OS — Full COO Parity Design

**Date:** 2026-03-26
**Approach:** Sprint Sequence (A) — Foundation → Report Depth → New Tabs
**Scope:** Three independent sprints, each QA-able on its own

---

## Context

The COO's reference dashboard (`bookkeeping_suite.html`) is the gold standard for what the WB Financial dashboard should look and feel like. This spec captures everything needed to reach full parity across all 17 tabs, plus an admin role that sees every page.

Stack: Pure HTML/CSS/JS (no build step). Data from Supabase REST API + hardcoded seed. Charts via Chart.js 4.4.1.

**Established entities:** WBP, LP, KP, BP, ONEOPS (in CLAUDE.md). SWAG, RUSH, SP1 appear in `_bankAccounts` seed and the COO reference — treat them as active entities; add them to the entity dropdown if not already present.

---

## Sprint 1 — Foundation

### 1.1 Admin Role

Add a 4th entry to the `ROLES` constant in `app.js`. Page ID strings must match the actual `data-page` attributes in `index.html`:

```js
admin: {
  label: 'Admin',
  color: '#7C3AED',
  pages: ['dashboard','inbox','ledger','journals','pnl','balance','cashflow',
          'ratios','cfnotes','ap','reconcile','sales','productmix',
          'forecast','invoices','rules','settings','import']
}
```

> **Page ID note:** Use the exact `data-page` values from `index.html`. The P&L page ID is `pnl` (not `pl`). `rules`, `settings`, and `import` do not yet have dedicated `<div id="page-*">` page divs — they are either inline content or new pages added in this sprint. When adding them, use `data-page="rules"`, `data-page="settings"`, `data-page="import"` for consistency.

- Login screen: add a 4th tile — **Admin** / `wb-admin-2026` with purple accent (`#7C3AED`)
- Every sidebar `data-roles` attribute: append `admin` (e.g. `data-roles="coo bookkeeper cpa admin"`)
- Admin nav badge: purple pill label next to the username in the topbar

### 1.2 Global Sticky Filter Bar

A new `<div id="globalFilterBar">` inserted between the topbar and `#main-content`. Visible on all pages except those with `data-page="settings"`, `data-page="rules"`, and `data-page="import"`. Since these three pages do not yet exist as dedicated page divs, the hide logic is implemented as an allowlist: the filter bar is shown only when `state.activePage` is one of the 14 report/data pages (`dashboard`, `inbox`, `ledger`, `journals`, `pnl`, `balance`, `cashflow`, `ratios`, `cfnotes`, `ap`, `reconcile`, `sales`, `productmix`, `forecast`, `invoices`).

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
    <option value="WBP">WB Promo</option>
    <option value="LP">Lanyard Promo</option>
    <option value="KP">Koolers Promo</option>
    <option value="BP">Band Promo</option>
    <option value="SWAG">SWAG</option>
    <option value="RUSH">RUSH</option>
    <option value="ONEOPS">One Operations</option>
  </select>
  <div id="gfbChips" class="gfb-chips"></div>
</div>
```

**Period resolution — semantic values → ISO date ranges:**

| Button value | Resolves to (for Supabase `gte`/`lte` filters) |
|---|---|
| `month` | First day of current month → today |
| `last-month` | First → last day of prior month |
| `qtd` | First day of current quarter → today |
| `ytd` | Jan 1 of current year → today |
| `custom` | Opens a two-input date picker (`<input type="date">`) in a popover; values set manually |

`app.resolveGlobalPeriod()` converts the semantic value to `{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }`. All Supabase queries use this object for date filtering. `state.currentPeriod` (the existing `YYYY-MM` string) is **replaced** by `state.globalPeriod` (semantic string) + `state.globalPeriodRange` (`{ from, to }`). All ~25 existing call sites of `state.currentPeriod` are migrated to read `state.globalPeriodRange`.

**State management:**

```js
state.globalPeriod = 'month';           // semantic
state.globalPeriodRange = { from: '2026-03-01', to: '2026-03-26' }; // resolved
state.globalEntity = 'all';             // replaces state.currentEntity
```

`state.currentEntity` and `state.currentPeriod` are removed. All existing references updated to `state.globalEntity` and `state.globalPeriodRange`.

`onGlobalFilterChange()` recalculates `state.globalPeriodRange`, updates topbar pills, re-renders the active page.

**CSS:**
```css
#globalFilterBar {
  position: sticky;
  top: 56px; /* topbar height */
  z-index: 90;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.gfb-btn { font-size: 0.75rem; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text2); cursor: pointer; }
.gfb-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.gfb-chips { display: flex; gap: 6px; margin-left: auto; }
.gfb-chip { font-size: 0.68rem; padding: 2px 8px; border-radius: 10px; background: var(--border2); color: var(--text2); cursor: pointer; }
```

Dark mode: `[data-theme="dark"] #globalFilterBar { background: var(--surface); border-color: var(--border); }` — CSS variables already handle this.

### 1.3 Topbar KPI Pills

Two `<span>` elements injected into the topbar right section (next to dark mode toggle):

```html
<span id="topbarBank" class="topbar-kpi">Bank: —</span>
<span id="topbarNet"  class="topbar-kpi">Net: —</span>
```

**Calculation:**
- When `state.globalEntity === 'all'`: sum all `_bankAccounts[].balance`
- When a specific entity is selected: sum only accounts where `account.entity === state.globalEntity`
- `_ccPayables` is a global scalar (total across all entities). When a specific entity is selected, CC payables display as "—" (per-entity breakdown not available from seed) with a tooltip: "CC payables shown for consolidated view only."

Updated by `updateTopbarKPIs()` called from `onGlobalFilterChange()` and on login.

```css
.topbar-kpi { font-size: 0.72rem; font-weight: 700; padding: 3px 10px; border-radius: 6px; background: var(--border2); color: var(--text2); }
```

### 1.4 Import Modal

A `<dialog id="importModal">` that **augments** the existing import flow. The existing Inbox page import drop zone remains. This modal is accessed via a new `<li data-page="import">` sidebar nav item (visible to all roles including admin).

**Features:**
- Drag-drop zone + `<input type="file">` accepting `.xlsx`, `.csv`, `.qbo`
- SheetJS already loaded in `index.html` — no new CDN dependency needed
- Column mapping UI: auto-detected headers → `transactions` schema fields (date, description, amount, entity, account_id)
- 10-row preview table before commit
- Bulk insert to Supabase `transactions` via REST POST (`/rest/v1/transactions`)
- Progress indicator + success/error toast using the existing `.toast` component

---

## Sprint 2 — Report Depth

### 2.1 P&L — 5 View Modes

Tab strip above the P&L table (rendered as `<div class="pl-mode-tabs">`):

```
Summary | Detail | By Entity | vs Prior Year | vs Budget
```

| Mode | Columns |
|------|---------|
| Summary | Category · Amount · % Revenue |
| Detail | Category · Sub-category · Amount · % |
| By Entity | Category · WBP · LP · KP · BP · SWAG · RUSH · ONEOPS · Total |
| vs Prior Year | Category · Current · Prior Yr · $ Var · % Var |
| vs Budget | Category · Actual · Budget · $ Var · % Var |

**Data sources:**
- Summary / Detail / By Entity: existing Supabase `transactions` fetch grouped by account category
- vs Prior Year: same query with `state.globalPeriodRange` shifted back 12 months, compared to current
- vs Budget: `window._plBudget` seed data (see below). If the optional `pl_budget` Supabase table exists, prefer it. If neither has data for a category, show `—` in Budget column.

**`window._plBudget` seed (add to app.js near other seed data):**
```js
if (!window._plBudget) {
  window._plBudget = {
    revenue: 850000, cogs: 510000, gross_profit: 340000,
    operating_expenses: 178000, net_income: 162000
  };
}
```

**Optional Supabase table (create only if live budget data is needed — not required for Sprint 2):**
```sql
create table pl_budget (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  period text not null, -- 'YYYY-MM'
  category text not null,
  budgeted_amount numeric(12,2),
  created_at timestamptz default now(),
  unique(entity, period, category)
);
```

**Charts added below table:**
1. **Waterfall** — Revenue → COGS → Gross Profit → OpEx → Net Income (Chart.js bar with floating bars)
2. **Margin Trend** — 12-month rolling net margin % (line chart, uses 12 monthly fetches from Supabase)

### 2.2 Balance Sheet — 2-Column Layout

Split `#page-balance-sheet` into a CSS grid: Assets (left) / Liabilities + Equity (right).

```css
.two-col-bs { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 768px) { .two-col-bs { grid-template-columns: 1fr; } }
```

**Ratio cards** (3 cards above the table, `.bs-ratio-row`):
- **Current Ratio** = Current Assets ÷ Current Liabilities
- **Debt-to-Equity** = Total Liabilities ÷ Total Equity
- **Quick Ratio** = (Current Assets − Inventory) ÷ Current Liabilities

Values computed from BS line items at render time.

**Retained Earnings Waterfall chart:** Prior RE → Net Income → Distributions → Current RE. Uses seed data or Supabase `journal_entries` for distribution entries.

### 2.3 Cash Flow — GAAP 3-Statement

Restructure `#page-cashflow` (note: actual page ID is `cashflow`, not `cash-flow`) into 3 collapsible `<details>` sections:

1. **Operating Activities** — net income + non-cash adjustments (D&A) + working capital changes (AR, AP, inventory)
2. **Investing Activities** — CapEx, asset purchases/sales (sourced from transaction categories tagged `investing`)
3. **Financing Activities** — loan proceeds/repayments, owner distributions (sourced from categories tagged `financing`)

Footer row: **Net Change in Cash** (sum of 3 subtotals) and **Ending Cash Balance** (net change + prior period bank total from `_bankAccounts`).

### 2.4 Ratios — Charts Upgrade

Three new Chart.js visualizations added below the existing ratios table on `#page-ratios`:

1. **EBITDA Bridge** — waterfall: EBIT → D&A add-back → EBITDA (floating bar chart)
2. **Budget vs Actual** — horizontal bar chart, top 8 expense categories vs `_plBudget` seed
3. **Margin Trend** — 3-line chart (Gross / Operating / Net margin), 12 months of Supabase data

---

## Sprint 3 — New & Enhanced Tabs

### 3.1 AP/Payables (new tab — Supabase)

New sidebar nav item: `<li data-page="ap" data-roles="coo cpa admin">AP / Payables</li>`

**New Supabase table: `ap_items`**

```sql
create table ap_items (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  vendor text not null,
  invoice_date date,
  due_date date not null,
  amount numeric(12,2) not null,
  paid boolean default false,
  dispute_note text,
  created_at timestamptz default now()
);
```

> **Note:** `aging_bucket` is NOT a stored column — it is computed at render time from `due_date` vs today:
> ```js
> function agingBucket(dueDateStr) {
>   const days = Math.floor((Date.now() - new Date(dueDateStr)) / 86400000);
>   if (days < 0) return 'current';
>   if (days <= 30) return '1-30';
>   if (days <= 60) return '31-60';
>   if (days <= 90) return '61-90';
>   return '90+';
> }
> ```

**Tab UI:**
- KPI row: Total Outstanding | Overdue | Due This Week | Avg Days to Pay
- Aging summary bar (5 buckets, color-coded), clickable to filter table
- Full data table with **Pay** button (sets `paid=true` via Supabase PATCH) and **Dispute** button (opens a note input, sets a `dispute_note` — add `dispute_note text` column to `ap_items`)
- Filter by entity (reads `state.globalEntity`), vendor, aging bucket

### 3.2 Reconciliation (augments existing `reconcile` page — Supabase)

The existing `data-page="reconcile"` page is augmented (not replaced) with Supabase persistence.

**New Supabase table: `reconciliation_matches`**

```sql
create table reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  statement_txn_id text,   -- ID from raw_transactions; text not FK to avoid schema dependency
  book_txn_id uuid references transactions(id),
  entity text,
  amount numeric(12,2),
  match_status text default 'unmatched' check (match_status in ('matched','unmatched','pending','disputed')),
  matched_at timestamptz,
  created_at timestamptz default now()
);
```

**Tab UI:**
- Summary cards: Matched | Unmatched | Pending Review | Disputed
- Two-column view: Bank Statement rows (left, from `raw_transactions`) vs Book Transactions (right, from `transactions`)
- **Auto-match** button behavior:
  1. Runs JS fuzzy match: same entity + amount within $0.01 + date within ±3 days
  2. For each confident match (1:1, no duplicate candidates): writes `match_status='matched'` to `reconciliation_matches`
  3. For ambiguous matches (multiple candidates): writes `match_status='pending'` — shown to user for manual confirmation
  4. Unmatched rows remain `match_status='unmatched'`
  5. User can click **Confirm** on pending rows (→ `matched`) or **Dispute** (→ `disputed`)
- **Manual match**: click a statement row then click a book row to link them; saves as `match_status='matched'`

### 3.3 CFO Notes — 6 Formal Notes

New sidebar nav item for all roles: `<li data-page="cfnotes" data-roles="coo cpa admin">CFO Notes</li>` (already exists, augment the page content).

**Executive banner** at top: entity name, reporting period (`state.globalPeriodRange.from` → `state.globalPeriodRange.to`), "Prepared by: Finance Team", legal disclaimer in footer.

**Six note cards** (rich-text, `contenteditable`, auto-saved to `localStorage`):

1. Revenue Recognition
2. Significant Transactions
3. Contingent Liabilities
4. Related Party Transactions
5. Subsequent Events
6. Going Concern / Liquidity

**localStorage key:** `cfnote_${entity}_${state.globalPeriod}_${year}_${noteIndex}` where `year` is the 4-digit year from `state.globalPeriodRange.from`. Example: `cfnote_WBP_month_2026_0`. Including the semantic period string prevents collisions between, e.g., a `ytd` note and a `custom` note that both start in January 2026. For the `custom` period, the key uses the literal string `custom` — users understand these notes are for their custom range. Known limitation: two different `custom` ranges in the same year share a key; this is acceptable for the current use case.

**Print/Export** button: `window.print()` with a `@media print` CSS block that hides nav, topbar, filter bar, and shows notes full-width on white background.

### 3.4 Sales

Augment existing `data-page="sales"` page:

- **Live revenue banner** — current month total (large `<div class="sales-live-banner">`), sourced from Supabase `transactions` filtered to current month + revenue categories
- **Weekly bar chart** — 7-day rolling revenue (Chart.js bar, 7 daily buckets)
- **Monthly performance table** — MTD vs prior month vs `_plBudget.revenue/12` monthly budget, % variance columns

### 3.5 Product Mix

Augment existing `data-page="productmix"` page:

- **Today's KPIs** — units sold, AOV, top SKU (from `window._productMix` seed, already in app.js)
- **Ad platform breakdown** — Meta / Google / TikTok spend vs revenue (grouped bar chart, from `_productMix.adSpend` seed)
- **Channel mix donut** — revenue share by channel (online / retail / wholesale / other)

If `_productMix` seed doesn't have `adSpend` key, add it:
```js
window._productMix.adSpend = { meta: 18400, google: 12700, tiktok: 6200 };
window._productMix.channels = { online: 0.52, retail: 0.28, wholesale: 0.14, other: 0.06 };
```

### 3.6 Cash Forecast

Augment existing `data-page="forecast"` page:

- **Editable monthly 2026 table**: rows = revenue/expense categories, columns = Jan–Dec
- Cells use `contenteditable="true"` with `input` event → parse float → update running totals
- Footer row: auto-sum per column
- **Forecast vs Actual** delta column for months where `globalPeriodRange.to` has passed — amber highlight if over by >10%
- Saves to `localStorage` keyed by `forecast_${entity}_2026` (one object per entity, not per period)

### 3.7 Invoices — AR Aging

Augment existing `data-page="invoices"` table:

- **Age (days)** column — `Math.floor((Date.now() - new Date(invoice.due_date)) / 86400000)`, negative = not yet due
- **Aging Bucket** column — Current / 30 / 60 / 90+ as a color-coded chip (same `agingBucket()` function from 3.1)

Add aging summary grid above the table (`.aging-grid`, 5 columns):

| Current | 1–30 Days | 31–60 Days | 61–90 Days | 90+ Days |
|---------|-----------|------------|------------|----------|
| $xxx    | $xxx      | $xxx       | $xxx       | $xxx     |

Each cell is clickable and filters the table to that bucket. Active filter shown as a dismissable chip.

---

## Data & State Reference

| State key | Type | Description |
|---|---|---|
| `state.globalPeriod` | string | Semantic period: `'month'`, `'last-month'`, `'qtd'`, `'ytd'`, `'custom'` |
| `state.globalPeriodRange` | `{from, to}` | ISO date strings, resolved from `globalPeriod` |
| `state.globalEntity` | string | Entity code or `'all'` |

**Migration of `state.currentPeriod` — 4 usage patterns:**

The existing codebase uses `state.currentPeriod` in approximately 25 places across 4 distinct patterns. Each pattern has a specific migration:

| Pattern | Example call site | Migration |
|---|---|---|
| **Supabase date-range filter** | `fetchReportData(entity, period)` → builds `gte`/`lte` query | Replace with `state.globalPeriodRange.from` / `state.globalPeriodRange.to` |
| **Display label** | `getPeriodLabel(state.currentPeriod)` → "March 2026" | Replace with `getPeriodLabel(state.globalPeriod)` — update `getPeriodLabel()` to accept semantic strings |
| **CSV/export filename suffix** | `filename = 'report-' + state.currentPeriod + '.csv'` | Replace with `state.globalPeriodRange.from.slice(0,7)` (e.g. `'2026-03'`) |
| **Supabase period-column equality** | `.eq('period', state.currentPeriod)` (in `closed_periods` and `journal_entries` fetches) | Replace with `.gte('period', state.globalPeriodRange.from.slice(0,7)).lte('period', state.globalPeriodRange.to.slice(0,7))` |

`state.currentEntity` → `state.globalEntity` (simple rename, ~15 call sites, no behavior change).
`resolveGlobalPeriod(semantic)` is the single function responsible for the semantic → `{from, to}` conversion.

---

## File Impacts

| File | Changes |
|------|---------|
| [index.html](index.html) | Admin login tile, `#globalFilterBar`, topbar pill spans, AP nav item, 5 P&L mode tabs, BS 2-col layout, CF 3-section `<details>`, import nav item, import modal `<dialog>` |
| [app.js](app.js) | `ROLES.admin`, `resolveGlobalPeriod()`, `onGlobalFilterChange()`, `updateTopbarKPIs()`, `updatePL(mode)`, `updateBS()` with ratios + RE waterfall, `updateCashFlow()` 3-section, new ratio chart functions, AP fetch+render+pay/dispute, Recon auto-match + manual match + Supabase writes, CFO notes autosave, Sales weekly chart + monthly table, ProductMix ad + channel charts, Forecast contenteditable + localStorage, Invoice aging grid + columns, `_plBudget` + `_productMix.adSpend/channels` seed additions |
| [styles.css](styles.css) | `#globalFilterBar`, `.gfb-btn`, `.gfb-chips`, `.gfb-chip`, `.topbar-kpi`, `.pl-mode-tabs`, `.two-col-bs`, `.bs-ratio-row`, `.aging-grid`, `.ap-kpi-row`, `.recon-split`, `.cfr-note-card`, `.sales-live-banner`, print `@media` block — all using existing CSS variables so dark mode works automatically |

**Dark mode:** All new components use existing CSS custom properties (`var(--surface)`, `var(--border)`, `var(--text2)`, `var(--accent)`, etc.). No additional `[data-theme="dark"]` overrides needed beyond those already defined in `styles.css` for the base variables. Exception: `.cfr-note-card` (white background in light mode) needs: `[data-theme="dark"] .cfr-note-card { background: var(--surface2); }`.

---

## Verification Checklist

- [ ] Admin login with `wb-admin-2026` shows all sidebar items (inbox, ledger, journals, pnl, balance, cashflow, ratios, cfnotes, ap, reconcile, sales, productmix, forecast, invoices, rules, settings, import)
- [ ] Global filter bar sticks below topbar at `top: 56px`; clicking "Last Month" re-renders active page with prior month data
- [ ] "Custom" period button opens a two-input date popover; selected range appears as a chip
- [ ] Topbar shows Bank/Net pills; selecting a specific entity shows only that entity's bank balance; Net pill shows "—" for CC when entity-filtered
- [ ] Import modal accepts `.xlsx` and `.csv`, shows 10-row preview with column mapping, inserts to Supabase `transactions`
- [ ] P&L has 5 mode tabs; By Entity mode shows WBP/LP/KP/BP/SWAG/RUSH/ONEOPS columns; vs Budget uses `_plBudget` seed; waterfall + margin trend charts render
- [ ] Balance Sheet shows 2-column layout with 3 ratio cards (Current Ratio, D/E, Quick Ratio) and RE waterfall chart
- [ ] Cash Flow shows 3 collapsible `<details>` sections; Net Change in Cash matches sum of 3 subtotals
- [ ] Ratios page has EBITDA bridge, budget vs actual (horizontal bar), and margin trend (3-line) charts
- [ ] AP tab fetches from Supabase `ap_items`; aging buckets computed client-side from `due_date`; Pay button sets `paid=true` via Supabase PATCH
- [ ] Reconciliation auto-match writes confident matches as `'matched'`, ambiguous as `'pending'`; manual match works; Dispute sets `'disputed'`
- [ ] CFO Notes shows 6 cards; edits persist across page navigations; localStorage key includes year (`cfnote_WBP_2026_0`)
- [ ] Sales shows live revenue banner, 7-day weekly chart, monthly table vs budget
- [ ] Product Mix shows today KPIs, Meta/Google/TikTok grouped bar, channel donut
- [ ] Cash Forecast editable cells auto-sum; completed months show Forecast vs Actual delta; saves to `localStorage`
- [ ] Invoices table has Age and Aging Bucket columns; aging summary grid clickable-filters table
- [ ] Dark mode: all new components render correctly; `.cfr-note-card` uses `var(--surface2)` in dark mode
