# Phase 3 — Reports Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild P&L and Balance Sheet to read dynamically from the `transactions` and `journal_entries` tables, replacing the Phase 1 empty-state placeholders with real data.

**Architecture:** Both reports query Supabase directly, grouping `transactions` by `account_type` / `account_subtype` for the period and entity in scope. Journal entries with a matching `period` are included as a separate line. Amount convention: positive = income/asset increase, negative = expense/liability increase (from Phase 1 spec). No hardcoded scaling factors.

**Tech Stack:** Vanilla JS, Supabase REST.

**Prerequisite:** Phase 2 complete. At least some classified transactions must exist in the `transactions` table to verify reports.

---

### Task 1: Build a shared data-fetch helper for reports

**Files:**
- Modify: `app.js` — add `fetchReportData(entity, period)`

A single helper used by both P&L and Balance Sheet to avoid duplicating Supabase queries.

- [ ] **Step 1: Add `fetchReportData()` to `app.js` (above the P&L method)**

```js
async fetchReportData(entity, period) {
  // Query transactions for the given period
  let txnQuery = supabaseClient
    .from('transactions')
    .select('amount, account_id, accounts(id, account_code, account_name, account_type, account_subtype, line, is_elimination)')
    .gte('acc_date', period + '-01')
    .lte('acc_date', period + '-31');

  if (entity !== 'all') txnQuery = txnQuery.eq('entity', entity);

  const { data: txns, error: txnErr } = await txnQuery;
  if (txnErr) { console.error('Report txn error:', txnErr); return null; }

  // Query journal entries via ledger_entries sub-table (confirmed schema)
  const { data: journals, error: jeErr } = await supabaseClient
    .from('journal_entries')
    .select('id, accounting_date, description, entry_type, period, entity_id, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name, account_type, account_subtype))')
    .eq('period', period);

  // Flatten ledger_entries into a consistent format for callers
  const flatJournals = (journals || []).map(je => ({
    ...je,
    // net = sum of (debit - credit) across all ledger lines, for simple P&L inclusion
    netAmount: (je.ledger_entries || []).reduce((s, l) =>
      s + (Number(l.debit_amount || 0) - Number(l.credit_amount || 0)), 0)
  }));

  return {
    txns: txns || [],
    journals: flatJournals
  };
},
```

**Note to implementer:** If `journal_entries` uses a `ledger_entries` sub-table (as shown in the existing Supabase loader), adjust the select to:
```js
.select('id, accounting_date, description, entry_type, period, entity_id, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name, account_type, account_subtype))')
```
And flatten `ledger_entries` when computing the net amounts.

- [ ] **Step 2: Add grouping helper**

```js
groupByAccount(txns) {
  // Returns a map: account_id → { account, total }
  const groups = {};
  for (const t of txns) {
    const acct = t.accounts;
    if (!acct) continue;
    if (!groups[t.account_id]) {
      groups[t.account_id] = { account: acct, total: 0 };
    }
    groups[t.account_id].total += Number(t.amount);
  }
  return groups;
},
```

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add shared fetchReportData helper for P&L and Balance Sheet"
```

---

### Task 2: Confirm report helper functions exist

**Files:** No changes needed.

- [ ] **Step 1: Verify `pnlSection`, `pnlLine`, `pnlTotal`, `pnlGrand` are already in app.js**

These helpers are defined at lines 1595–1620 of `app.js` (from the original codebase). They are NOT removed in Phase 1. Confirm they still exist before proceeding:

```bash
grep -n "function pnlSection\|function pnlLine\|function pnlTotal\|function pnlGrand" app.js
```

Expected: 4 matches around lines 1595–1615. If missing, they must be restored from git history.

---

### Task 3: Rebuild P&L from live transactions

**Files:**
- Modify: `app.js:491` — replace `renderPnL()` (currently Phase 1 empty-state placeholder)

- [ ] **Step 1: Replace `renderPnL()` with dynamic version**

```js
async renderPnL(entity) {
  if (entity === undefined) entity = state.currentEntity;
  const period = state.currentPeriod;
  const el = document.getElementById('pnlReport');

  el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

  const data = await this.fetchReportData(entity, period);
  if (!data) { el.innerHTML = '<div style="padding:32px;color:var(--red)">Failed to load report</div>'; return; }

  const groups = this.groupByAccount(data.txns);

  // Sort accounts into P&L buckets
  const bySubtype = (subtype) => Object.values(groups)
    .filter(g => g.account.account_subtype === subtype && !g.account.is_elimination);
  const byType = (type, excludeSubtypes = []) => Object.values(groups)
    .filter(g => g.account.account_type === type && !g.account.is_elimination
      && !excludeSubtypes.includes(g.account.account_subtype));

  const revenueLines = byType('revenue', ['contra']);
  const contraLines  = bySubtype('contra');
  const cogsLines    = bySubtype('cogs');
  const adLines      = bySubtype('advertising');
  const payrollLines = bySubtype('payroll');
  const platformLines= bySubtype('platform');
  const opexLines    = byType('expense', ['cogs','advertising','payroll','platform','commission']);

  const sumLines = (lines) => lines.reduce((s, g) => s + g.total, 0);

  const totalRevenue  = sumLines(revenueLines);
  const totalContra   = Math.abs(sumLines(contraLines));
  const totalIncome   = totalRevenue - totalContra;
  const totalCogs     = Math.abs(sumLines(cogsLines));
  const grossProfit   = totalIncome - totalCogs;
  const totalAd       = Math.abs(sumLines(adLines));
  const totalPayroll  = Math.abs(sumLines(payrollLines));
  const totalPlatform = Math.abs(sumLines(platformLines));
  const totalOpex     = Math.abs(sumLines(opexLines));
  const totalExpenses = totalCogs + totalAd + totalPayroll + totalPlatform + totalOpex;
  const noi           = totalIncome - totalExpenses;

  // Adjusting entries from journal_entries (use pre-flattened netAmount from fetchReportData)
  const adjusting = (data.journals || []).filter(j => j.entry_type === 'adjusting');
  const totalAdj  = adjusting.reduce((s, j) => s + (j.netAmount || 0), 0);

  const netProfit = noi + totalAdj;
  const marginPct = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : '—';
  const grossPct  = totalIncome > 0 ? ((grossProfit / totalIncome) * 100).toFixed(1) : '—';

  const renderLines = (lines, isExpense = false) => lines.map(g => {
    const val = isExpense ? Math.abs(g.total) : g.total;
    return pnlLine(`${g.account.account_code} — ${g.account.account_name}`, val, 2);
  }).join('');

  el.innerHTML = `
    <div class="report-header">
      <h2>Profit & Loss Statement</h2>
      <p>WB Brands LLC — ${entity === 'all' ? 'Consolidated' : entity} · ${this.getPeriodLabel(period)} · Accrual basis</p>
    </div>

    ${pnlSection('Gross Revenue')}
    ${renderLines(revenueLines)}
    ${contraLines.length ? pnlLine('Returns and cancellations', -totalContra, 1, 'neg') : ''}
    ${pnlTotal('Total Revenue', totalIncome, 'pos')}

    ${pnlSection('Cost of Goods Sold')}
    ${renderLines(cogsLines, true)}
    ${pnlTotal('Gross Profit', grossProfit, grossProfit >= 0 ? 'pos' : 'neg')}
    ${pnlLine(`Gross margin: ${grossPct}%`, null, 1, 'muted')}

    ${pnlSection('Operating Expenses')}
    ${adLines.length ? pnlLine('Advertisement', null, 1, 'group') + renderLines(adLines, true) : ''}
    ${payrollLines.length ? pnlLine('Wages & Payroll', null, 1, 'group') + renderLines(payrollLines, true) : ''}
    ${platformLines.length ? pnlLine('Platform fees', null, 1, 'group') + renderLines(platformLines, true) : ''}
    ${opexLines.length ? pnlLine('Other operating expenses', null, 1, 'group') + renderLines(opexLines, true) : ''}
    ${pnlTotal('Total Operating Expenses', totalExpenses)}

    ${pnlGrand('Net Operating Income', noi, noi >= 0 ? 'pos' : 'neg')}

    ${adjusting.length ? `
      ${pnlSection('Adjusting Entries')}
      ${adjusting.map(j => pnlLine(j.description || 'Adjustment', totalAdj, 1)).join('')}
      ${pnlTotal('Total Adjustments', totalAdj, totalAdj >= 0 ? 'pos' : 'neg')}
    ` : ''}

    ${pnlGrand('Net Profit', netProfit, netProfit >= 0 ? 'pos' : 'neg')}
    ${pnlLine(`Net margin: ${marginPct}%`, null, 1, 'muted')}

    ${totalIncome === 0 ? `
      <div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">
        No transactions classified for this period/entity. Classify transactions in the Inbox.
      </div>
    ` : ''}
  `;
},
```

- [ ] **Step 2: Update `setPnlEntity()` to await**

```js
setPnlEntity(val) { this.renderPnL(val); },
// Change to:
async setPnlEntity(val) { await this.renderPnL(val); },
```

- [ ] **Step 3: Verify in browser**

With classified transactions in the DB:
1. Navigate to P&L
2. Expected: real line items grouped by account subtype
3. Change entity — numbers update to entity-specific total
4. Change period — numbers update to period-specific total
5. With no transactions for a period — shows the empty-state message

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: P&L report dynamically built from classified transactions"
```

---

### Task 3: Rebuild Balance Sheet from live transactions

**Files:**
- Modify: `app.js` — replace `renderBalance()` (currently Phase 1 empty-state placeholder)

Balance Sheet is cumulative (all time), not period-filtered.

- [ ] **Step 1: Add a cumulative balance fetch helper**

```js
async fetchBalanceSheetData(entity) {
  let query = supabaseClient
    .from('transactions')
    .select('amount, account_id, accounts(id, account_code, account_name, account_type, account_subtype, is_elimination)');

  // Balance Sheet is cumulative (no period filter)
  if (entity !== 'all') query = query.eq('entity', entity);

  const { data: txns, error } = await query;
  if (error) { console.error('Balance Sheet error:', error); return null; }
  return txns || [];
},
```

- [ ] **Step 2: Replace `renderBalance()` with dynamic version**

```js
async renderBalance() {
  const entity = state.currentEntity;
  const period = this.getPeriodLabel(state.currentPeriod);
  const el = document.getElementById('balanceReport');

  el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

  const [bsTxns, pnlData] = await Promise.all([
    this.fetchBalanceSheetData(entity),
    this.fetchReportData(entity, state.currentPeriod)
  ]);

  if (!bsTxns) { el.innerHTML = '<div style="padding:32px;color:var(--red)">Failed to load</div>'; return; }

  const groups = this.groupByAccount(bsTxns);

  const byType = (type) => Object.values(groups)
    .filter(g => g.account.account_type === type && !g.account.is_elimination);

  const assetLines    = byType('asset');
  const liabLines     = byType('liability');
  const equityLines   = byType('equity');

  const sumLines = (lines) => lines.reduce((s, g) => s + g.total, 0);

  const totalAssets = sumLines(assetLines);
  const totalLiab   = Math.abs(sumLines(liabLines));

  // Net profit for current period (from P&L data)
  // Note: Balance Sheet shows cumulative asset/liability balances (no period filter)
  // but Net Profit in equity IS period-scoped (current period P&L). This is intentional and correct.
  let netProfit = 0;
  if (pnlData) {
    const pnlGroups = this.groupByAccount(pnlData.txns);
    const revenueTotal = Object.values(pnlGroups)
      .filter(g => g.account.account_type === 'revenue')
      .reduce((s, g) => s + g.total, 0);
    const expenseTotal = Object.values(pnlGroups)
      .filter(g => g.account.account_type === 'expense')
      .reduce((s, g) => s + Math.abs(g.total), 0);
    netProfit = revenueTotal - expenseTotal;
  }

  const totalEquity = sumLines(equityLines) + netProfit;
  const totalLiabEquity = totalLiab + totalEquity;
  const balanced = Math.abs(totalAssets - totalLiabEquity) < 1;

  const renderLines = (lines, isLiab = false) => lines.map(g => {
    const val = isLiab ? Math.abs(g.total) : g.total;
    return pnlLine(`${g.account.account_code} — ${g.account.account_name}`, val, 2);
  }).join('');

  el.innerHTML = `
    <div class="report-header">
      <h2>Balance Sheet</h2>
      <p>WB Brands LLC — ${entity === 'all' ? 'Consolidated' : entity} · As of ${period}</p>
    </div>

    ${pnlSection('Assets')}
    ${renderLines(assetLines)}
    ${pnlTotal('Total Assets', totalAssets, 'pos')}

    ${pnlSection('Liabilities')}
    ${renderLines(liabLines, true)}
    ${pnlTotal('Total Liabilities', totalLiab)}

    ${pnlSection('Equity')}
    ${renderLines(equityLines)}
    ${pnlLine('Net profit (current period)', netProfit, 2, netProfit >= 0 ? 'pos' : 'neg')}
    ${pnlTotal('Total Equity', totalEquity, totalEquity >= 0 ? 'pos' : 'neg')}

    ${pnlGrand('Total Liabilities + Equity', totalLiabEquity, 'pos')}
    ${!balanced ? `<div style="color:var(--red);padding:8px;font-size:13px">⚠ Balance sheet is out of balance by ${fmt(Math.abs(totalAssets - totalLiabEquity))}</div>` : ''}

    ${totalAssets === 0 && totalLiab === 0 ? `
      <div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">
        No transactions classified yet.
      </div>
    ` : ''}
  `;
},
```

- [ ] **Step 3: Verify in browser**

Navigate to Balance Sheet with classified transactions. Expected:
- Asset, liability, equity sections populated from real accounts
- Net profit line matches P&L net profit for the period
- Balance validation line matches (or shows warning if not)

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: Balance Sheet dynamically built from classified transactions"
```

---

### Task 4: Update Dashboard KPIs to use `fetchReportData`

The Phase 1 dashboard KPI query was written directly. Refactor to reuse `fetchReportData` for consistency.

**Files:**
- Modify: `app.js` — `updateDashboardKPIs()`

- [ ] **Step 1: Refactor `updateDashboardKPIs` to use `fetchReportData`**

```js
async updateDashboardKPIs() {
  const entity = state.currentEntity;
  const period = state.currentPeriod;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val !== null ? fmt(val) : '—';
  };

  ['m-revenue','m-income','m-gp','m-np','m-cash','m-adspend'].forEach(id => set(id, 0));
  if (!supabaseClient) return;

  const data = await this.fetchReportData(entity, period);
  if (!data) return;

  const groups = this.groupByAccount(data.txns);
  const byType    = (type) => Object.values(groups).filter(g => g.account.account_type === type);
  const bySubtype = (sub)  => Object.values(groups).filter(g => g.account.account_subtype === sub);
  const sum = (arr) => arr.reduce((s, g) => s + g.total, 0);

  const revenue  = sum(byType('revenue'));
  const expenses = Math.abs(sum(byType('expense')));
  const cogs     = Math.abs(sum(bySubtype('cogs')));
  const adSpend  = Math.abs(sum(bySubtype('advertising')));
  const gp       = revenue - cogs;
  const np       = revenue - expenses;

  set('m-revenue', revenue);
  set('m-income',  revenue);
  set('m-gp',      gp);
  set('m-np',      np);
  set('m-adspend', adSpend);
  set('m-cash',    0); // Phase 4 / bank sync

  const npEl = document.getElementById('m-np');
  if (npEl && revenue > 0) {
    const delta = npEl.parentElement?.querySelector('.metric-delta');
    if (delta) delta.textContent = ((np / revenue) * 100).toFixed(1) + '% margin';
  }
  const gpEl = document.getElementById('m-gp');
  if (gpEl && revenue > 0) {
    const delta = gpEl.parentElement?.querySelector('.metric-delta');
    if (delta) delta.textContent = ((gp / revenue) * 100).toFixed(1) + '% margin';
  }
},
```

- [ ] **Step 2: Verify in browser**

Dashboard KPIs should now match P&L numbers for the same period and entity.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "refactor: dashboard KPIs use fetchReportData for consistency with P&L"
```

---

### Task 5: Push Phase 3 to QA

- [ ] **Step 1: Final browser check**

Checklist:
- [ ] P&L shows real line items grouped by account subtype
- [ ] P&L updates when entity/period filters change
- [ ] Balance Sheet shows real accounts
- [ ] Balance Sheet shows net profit from current P&L period
- [ ] Balance validation line is correct (or shows warning)
- [ ] Dashboard KPIs match P&L numbers for same period
- [ ] Empty state shown when no data for period

- [ ] **Step 2: Push to qa**

```bash
git checkout qa
git merge main
git push origin qa
git checkout main
```
