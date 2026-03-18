# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken Supabase connection, migrate the DB schema, clear all sample data, and strip out every hardcoded number so the app loads entirely from live Supabase data (zero state if empty).

**Architecture:** All changes are in `app.js` and a SQL migration run in the Supabase SQL editor. No backend code — the app is vanilla JS talking directly to Supabase REST. Remove the `DATA` object fallback; Supabase is now required. If Supabase is unreachable, show an error — never fall back to fake data.

**Tech Stack:** Vanilla JS, Supabase REST API via `@supabase/supabase-js` (already loaded in `index.html`), Supabase SQL Editor for migrations.

---

### Task 1: Fix Supabase URL typo

**Files:**
- Modify: `app.js:6,9`

- [ ] **Step 1: Fix the URL and comment**

In `app.js`, change lines 6 and 9:

```js
// Before (line 6):
// 1. Go to https://supabaseClient.com → your wb-finance-os project → Settings → API
// After:
// 1. Go to https://supabase.com → your wb-finance-os project → Settings → API

// Before (line 9):
const SUPABASE_URL = 'https://fxwjadkbvlvxtxxkjqkw.supabaseClient.co';
// After:
const SUPABASE_URL = 'https://fxwjadkbvlvxtxxkjqkw.supabase.co';
```

- [ ] **Step 2: Verify in browser**

Open `index.html` in a browser and open the DevTools console. Expected: no `ERR_NAME_NOT_RESOLVED` error. You should see Supabase requests succeeding (200 responses in the Network tab).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "fix: correct Supabase URL typo (supabaseClient.co → supabase.co)"
```

---

### Task 2: Run DB migrations in Supabase SQL Editor

**Where:** Supabase Dashboard → SQL Editor → New query

- [ ] **Step 1: Create `transactions` table**

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_transaction_id  UUID REFERENCES raw_transactions(id) UNIQUE,
  entity              TEXT NOT NULL,
  account_id          UUID REFERENCES accounts(id),
  amount              NUMERIC(12,2) NOT NULL,
  txn_date            DATE NOT NULL,
  acc_date            DATE NOT NULL,
  description         TEXT,
  memo                TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 2: Add columns to `raw_transactions`**

```sql
ALTER TABLE raw_transactions
  ADD COLUMN IF NOT EXISTS classified    BOOLEAN      DEFAULT false,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;
```

- [ ] **Step 3: Add `period` column to `journal_entries`**

(`entry_type` already exists in this table — only `period` is missing.)

```sql
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS period TEXT;
```

- [ ] **Step 4: Create `closed_periods` table**

```sql
CREATE TABLE IF NOT EXISTS closed_periods (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period     TEXT        NOT NULL UNIQUE,
  entity     TEXT        NOT NULL DEFAULT 'all',
  closed_at  TIMESTAMPTZ DEFAULT now(),
  closed_by  TEXT
);
```

- [ ] **Step 5: Verify tables exist**

Run in SQL Editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected output includes: `accounts`, `closed_periods`, `entities`, `invoices`, `journal_entries`, `raw_transactions`, `transactions`, `vendors`.

---

### Task 3: Clear all sample data

**Where:** Supabase Dashboard → SQL Editor

- [ ] **Step 1: Delete all sample rows from transactional tables**

```sql
DELETE FROM transactions;
DELETE FROM raw_transactions;
DELETE FROM invoices;
DELETE FROM journal_entries;
DELETE FROM vendors;
-- Keep: entities (6 rows) and accounts (43 rows) — these are master/config data, not samples
```

- [ ] **Step 2: Verify tables are empty**

```sql
SELECT
  'raw_transactions' AS tbl, COUNT(*) FROM raw_transactions
UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
UNION ALL SELECT 'journal_entries', COUNT(*) FROM journal_entries
UNION ALL SELECT 'vendors', COUNT(*) FROM vendors;
```

Expected: all counts = 0.

---

### Task 4: Remove hardcoded data fallback from app.js

**Files:**
- Modify: `app.js:22-136` (DATA object), `app.js:252-256` (error handler), `app.js:1721-1726` (boot)

- [ ] **Step 1: Strip the DATA object down to empty arrays**

Replace lines 22–136 (the `DATA = { transactions: [...], vendors: [...], ... }` block) with:

```js
// ---- DATA STORE ----
// Data is loaded exclusively from Supabase. No hardcoded fallback.
const DATA = {
  transactions: [],
  vendors: [],
  invoices: [],
  journals: [],
  coa: [],
  banks: []
};
```

- [ ] **Step 2: Replace the error handler in `loadDataFromSupabase` with a hard error**

Replace lines 252–255:

```js
// Before:
  } catch (err) {
    console.error('Supabase load error:', err);
    app.toast('Offline mode — showing demo data');
  }

// After:
  } catch (err) {
    console.error('Supabase load error:', err);
    app.toast('Connection error — check Supabase credentials and refresh');
    document.getElementById('pageTitle').textContent = 'Connection Error';
    document.getElementById('pageSub').textContent = 'Could not connect to database. Check console for details.';
  }
```

- [ ] **Step 3: Remove the offline-mode else branch in the boot sequence**

Replace lines 1721–1726:

```js
// Before:
  if (DB_READY) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await loadDataFromSupabase();
  } else {
    console.info('WB Finance OS: Running in offline/demo mode...');
  }

// After:
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await loadDataFromSupabase();
```

Also delete `const DB_READY = ...` (line 13) — no longer needed.

- [ ] **Step 4: Also load COA accounts into DATA.coa from Supabase**

In `loadDataFromSupabase()`, after the accounts lookup block (around line 159), add:

```js
// Populate DATA.coa for COA page render
DATA.coa = (accounts || []).map(a => ({
  code: a.account_code,
  name: a.account_name,
  type: a.account_type,
  subtype: a.account_subtype,
  line: a.line || a.account_name,
  balance: 0,  // live balance computed in Phase 3
  elimination: a.is_elimination || false
}));
```

- [ ] **Step 5: Verify in browser**

Open `index.html`. Expected:
- Console shows no `YOUR_SUPABASE_URL` or `offline mode` messages
- Dashboard loads with all KPI cards showing `$0` (empty state)
- Transactions page shows empty table with no rows
- COA page shows all 43 accounts loaded from Supabase

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: remove hardcoded data fallback — Supabase is now required"
```

---

### Task 5: Fix default period to current month

**Files:**
- Modify: `app.js:262`

- [ ] **Step 1: Update default period in state**

```js
// Before (line 262):
currentPeriod: '2025-03',

// After:
currentPeriod: new Date().toISOString().slice(0, 7),
```

- [ ] **Step 2: Verify in browser**

Open `index.html`. The period picker in the top nav and page subtitles should show the current month (e.g., "March 2026"), not "March 2025".

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "fix: default period to current month instead of hardcoded 2025-03"
```

---

### Task 6: Replace hardcoded Dashboard KPIs with live Supabase aggregates

**Files:**
- Modify: `app.js:1495-1534` (`updateDashboardKPIs`)

- [ ] **Step 1: Replace `updateDashboardKPIs` with async version pulling from Supabase**

Replace the entire `updateDashboardKPIs()` method (lines 1495–1534) with:

```js
async updateDashboardKPIs() {
  const entity = state.currentEntity;
  const period = state.currentPeriod;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val !== null ? fmt(val) : '—';
  };

  // Zero out while loading
  ['m-revenue','m-income','m-gp','m-np','m-cash','m-adspend'].forEach(id => set(id, 0));

  if (!supabaseClient) return;

  // Build entity filter
  let txnQuery = supabaseClient
    .from('transactions')
    .select('amount, account_id, accounts(account_type, account_subtype)')
    .gte('acc_date', period + '-01')
    .lte('acc_date', period + '-31');

  if (entity !== 'all') txnQuery = txnQuery.eq('entity', entity);

  const { data: txns, error } = await txnQuery;
  if (error) { console.error('KPI load error:', error); return; }

  const rows = txns || [];

  const sumWhere = (fn) => rows.filter(fn).reduce((s, t) => s + Number(t.amount), 0);

  const revenue  = sumWhere(t => t.accounts?.account_type === 'revenue');
  const cogs     = Math.abs(sumWhere(t => t.accounts?.account_subtype === 'cogs'));
  const adSpend  = Math.abs(sumWhere(t => t.accounts?.account_subtype === 'advertising'));
  const expenses = Math.abs(sumWhere(t => t.accounts?.account_type === 'expense'));
  const income   = revenue;
  const gp       = revenue - cogs;
  const np       = revenue - expenses;

  set('m-revenue', revenue);
  set('m-income',  income);
  set('m-gp',      gp);
  set('m-np',      np);
  set('m-adspend', adSpend);

  // Cash: sum from transactions for asset/cash accounts (placeholder until bank sync)
  set('m-cash', 0);

  // Update margin deltas
  const npEl = document.getElementById('m-np');
  if (npEl && income > 0) {
    const delta = npEl.parentElement?.querySelector('.metric-delta');
    if (delta) delta.textContent = ((np / income) * 100).toFixed(1) + '% margin';
  }
  const gpEl = document.getElementById('m-gp');
  if (gpEl && income > 0) {
    const delta = gpEl.parentElement?.querySelector('.metric-delta');
    if (delta) delta.textContent = ((gp / income) * 100).toFixed(1) + '% margin';
  }
},
```

- [ ] **Step 2: Update all callers of `updateDashboardKPIs` to await it**

In `navigate()` (line ~305), `setEntity()` (line ~327), and the boot sequence (line ~1728):

```js
// Change all calls from:
this.updateDashboardKPIs();
// to:
await this.updateDashboardKPIs();
```

Note: `navigate()` currently wraps render calls in `setTimeout(() => { ... }, 10)`. For the dashboard case only, change to `await this.updateDashboardKPIs()` outside the setTimeout, or make the setTimeout callback async.

- [ ] **Step 3: Verify in browser**

Open dashboard. With empty DB:
- All KPI cards show `$0`
- No console errors from Supabase

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: dashboard KPIs now query live Supabase transactions"
```

---

### Task 7: Replace hardcoded P&L and Balance Sheet with empty-state placeholders

**Files:**
- Modify: `app.js:491-561` (`renderPnL`), `app.js:565-620` (`renderBalance`)

These will be fully rebuilt in Phase 3. For now, replace with clean empty states so the app doesn't show fake numbers.

- [ ] **Step 1: Replace `renderPnL` body**

```js
renderPnL(entity) {
  if (entity === undefined) entity = state.currentEntity;
  const el = document.getElementById('pnlReport');
  el.innerHTML = `
    <div class="report-header">
      <h2>Profit & Loss Statement</h2>
      <p>WB Brands LLC — ${entity === 'all' ? 'Consolidated' : entity} · ${this.getPeriodLabel(state.currentPeriod)} · Accrual basis</p>
    </div>
    <div style="padding:48px;text-align:center;color:var(--text3)">
      <p style="font-size:15px;margin-bottom:8px">No classified transactions yet</p>
      <p style="font-size:13px">Classify transactions in the Inbox to populate this report.</p>
    </div>
  `;
},
```

- [ ] **Step 2: Replace `renderBalance` body**

```js
renderBalance() {
  const entity = state.currentEntity;
  const period = this.getPeriodLabel(state.currentPeriod);
  const el = document.getElementById('balanceReport');
  el.innerHTML = `
    <div class="report-header">
      <h2>Balance Sheet</h2>
      <p>WB Brands LLC — ${entity === 'all' ? 'Consolidated' : entity} · As of ${period}</p>
    </div>
    <div style="padding:48px;text-align:center;color:var(--text3)">
      <p style="font-size:15px;margin-bottom:8px">No classified transactions yet</p>
      <p style="font-size:13px">Classify transactions in the Inbox to populate this report.</p>
    </div>
  `;
},
```

- [ ] **Step 3: Verify in browser**

Navigate to P&L and Balance Sheet pages. Expected: clean empty-state message, no fake dollar amounts.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: P&L and Balance Sheet show empty state (Phase 3 will populate)"
```

---

### Task 8: Remove Stripe-specific hardcoded references from dashboard charts

**Files:**
- Modify: `app.js:1632-1742` (`initDashboardCharts`)

The dashboard charts use hardcoded Stripe/PayPal/Wire random data. Replace with a neutral placeholder.

- [ ] **Step 1: Find the chart data lines**

In `initDashboardCharts()` (around line 1644–1648):

```js
const stripe = days.map(()=>Math.round(40000+Math.random()*35000));
const paypal = days.map(()=>Math.round(12000+Math.random()*14000));
const wire = days.map(()=>Math.round(8000+Math.random()*18000));
```

Replace the three arrays and their dataset labels:

```js
const revenue = days.map(() => 0);
const expenses = days.map(() => 0);
const net = days.map(() => 0);
```

Then update the chart dataset labels from `'Stripe'`/`'PayPal'`/`'Wire'` to `'Revenue'`/`'Expenses'`/`'Net'` throughout `initDashboardCharts`. (Search for `'Stripe'` in the function and replace all three.)

- [ ] **Step 2: Remove the hardcoded cash bar chart data**

Around lines 1694–1707, the cash bars chart uses hardcoded entity balances:

```js
const cashData = [
  {entity:'LP', balance:284100, ...},
  ...
];
```

Replace with:

```js
const cashData = [];  // populated in Phase 2 from real bank data
document.getElementById('cashBars').innerHTML =
  '<p style="color:var(--text3);font-size:13px;padding:12px">No bank data yet</p>';
return;  // skip chart render
```

- [ ] **Step 3: Verify in browser**

Dashboard charts should render without Stripe/PayPal labels. Revenue chart shows flat zero line. Cash bar section shows placeholder message.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "fix: remove Stripe/PayPal hardcoded chart data — charts show real data only"
```

---

### Task 9: Final integration check and push

- [ ] **Step 1: Open app in browser and verify full zero state**

Checklist:
- [ ] Console has no errors
- [ ] Dashboard KPIs all show `$0`
- [ ] Transactions page shows empty table
- [ ] Journals page shows empty table
- [ ] Vendors page shows empty table
- [ ] Invoices page shows empty table
- [ ] P&L shows empty-state message (no fake numbers)
- [ ] Balance Sheet shows empty-state message
- [ ] COA page shows all 43 accounts from Supabase
- [ ] Period picker shows current month

- [ ] **Step 2: Push to qa branch for QA review**

```bash
git checkout qa
git merge main
git push origin qa
git checkout main
```

Expected: Vercel deploys to QA URL automatically.
