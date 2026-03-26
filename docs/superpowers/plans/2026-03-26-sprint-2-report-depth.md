# Sprint 2 — Report Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the 4 existing report pages (P&L, Balance Sheet, Cash Flow, Ratios) to match COO-reference parity — adding 5 view modes to P&L, 2-column layout + ratio cards to Balance Sheet, GAAP 3-section structure to Cash Flow, and 3 charts to Ratios.

**Architecture:** Each report page is self-contained. Work page-by-page. Each task modifies the HTML for one page, then the JS render function for that page, then adds CSS. No cross-page dependencies except `_plBudget` seed (used by P&L and Ratios).

**Prerequisites:** Sprint 1 complete. `state.globalPeriodRange` and `state.globalEntity` are live.

**Tech Stack:** Chart.js 4.4.1 (already loaded), Supabase REST, vanilla JS

---

## File Map

| File | What changes |
|---|---|
| `app.js` | `_plBudget` seed; `renderPnl(mode)` — 5 modes; P&L waterfall + margin trend charts; `renderBalance()` — 2-col + ratios + RE waterfall; `renderCashFlow()` — 3 sections; Ratios page — 3 new charts |
| `index.html` | P&L mode tab strip; Balance Sheet 2-col wrapper; Cash Flow `<details>` sections |
| `styles.css` | `.pl-mode-tabs`; `.two-col-bs`; `.bs-ratio-row`; `.cf-section`; chart canvas wrappers |

---

## Task 1: P&L Seed Data + Mode Tab Strip

**Files:**
- Modify: `app.js` — add `_plBudget` seed near other seed data
- Modify: `index.html` — add mode tab strip inside `#page-pnl` above `#pnlReport`

- [ ] **Step 1: Add `_plBudget` seed to app.js**

Find the existing seed data block (near `_bankAccounts`, `_weeklyActuals`). Add:

```js
if (!window._plBudget) {
  window._plBudget = {
    revenue: 850000, cogs: 510000, gross_profit: 340000,
    operating_expenses: 178000, net_income: 162000
  };
}
```

- [ ] **Step 2: Add mode tab strip HTML in index.html**

Inside `#page-pnl`, find the toolbar div. Insert a mode tab row immediately below it (before `#pnlReport`):

```html
<div class="pl-mode-tabs" id="plModeTabs">
  <button class="pl-tab active" data-mode="summary" onclick="app.setPnlMode('summary')">Summary</button>
  <button class="pl-tab" data-mode="detail" onclick="app.setPnlMode('detail')">Detail</button>
  <button class="pl-tab" data-mode="entity" onclick="app.setPnlMode('entity')">By Entity</button>
  <button class="pl-tab" data-mode="prior" onclick="app.setPnlMode('prior')">vs Prior Year</button>
  <button class="pl-tab" data-mode="budget" onclick="app.setPnlMode('budget')">vs Budget</button>
</div>
```

- [ ] **Step 3: Add mode tabs CSS to styles.css**

```css
/* ---- P&L MODE TABS ---- */
.pl-mode-tabs {
  display: flex; gap: 4px; padding: 12px 0 4px;
  border-bottom: 1px solid var(--border); margin-bottom: 12px;
}
.pl-tab {
  font-size: 0.78rem; font-weight: 600; padding: 5px 14px;
  border-radius: 6px; border: 1px solid transparent;
  color: var(--text2); background: transparent; cursor: pointer;
  transition: all 0.12s;
}
.pl-tab:hover { background: var(--border2); color: var(--text); }
.pl-tab.active {
  background: var(--accent); color: #fff;
  border-color: var(--accent);
}
```

- [ ] **Step 4: Add `setPnlMode()` to app.js**

```js
setPnlMode(mode) {
  state.pnlMode = mode;
  document.querySelectorAll('.pl-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  // Re-trigger P&L render with current data
  this.navigate('pnl');
},
```

Also initialize `state.pnlMode = 'summary'` in the state object.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: P&L mode tab strip (Summary/Detail/By Entity/Prior/Budget)"
```

---

## Task 2: P&L — 5 View Mode Rendering

**Files:**
- Modify: `app.js` — update the P&L render function to branch on `state.pnlMode`

The existing P&L render function builds an HTML table in `#pnlReport`. We extend it to produce different columns per mode.

- [ ] **Step 1: Locate the P&L render function in app.js**

Search for `renderPnl` or `pnlReport` or `updatePnl` to find the function that populates `#pnlReport`. Note its exact name and where it's called from `navigate()`.

- [ ] **Step 2: Wrap existing render logic in a `mode === 'summary'` branch**

The current logic is Summary mode. Preserve it exactly, then add branches for other modes:

```js
async renderPnl() {
  const mode = state.pnlMode || 'summary';
  const entity = state.globalEntity;
  const range = state.globalPeriodRange;

  // Fetch current period data (always needed)
  const data = await this.fetchReportData(entity, range);
  if (!data) return;

  if (mode === 'summary') {
    this._renderPnlSummary(data);
  } else if (mode === 'detail') {
    this._renderPnlDetail(data);
  } else if (mode === 'entity') {
    await this._renderPnlByEntity(range);
  } else if (mode === 'prior') {
    await this._renderPnlVsPrior(data, range);
  } else if (mode === 'budget') {
    this._renderPnlVsBudget(data);
  }

  // Always render charts below the table
  await this._renderPnlCharts(data, range);
},
```

- [ ] **Step 3: Implement `_renderPnlSummary(data)` — keep existing logic, just move it here**

This is the current render output. Move the existing table-building code into this private method. The output goes into `#pnlReport`.

- [ ] **Step 4: Implement `_renderPnlDetail(data)` — expanded rows with sub-categories**

```js
_renderPnlDetail(data) {
  const container = document.getElementById('pnlReport');
  // Group transactions by account_type then account_subtype
  const groups = {};
  (data.txns || []).forEach(t => {
    const type = t.accounts?.account_type || 'Other';
    const sub  = t.accounts?.account_subtype || 'General';
    if (!groups[type]) groups[type] = {};
    if (!groups[type][sub]) groups[type][sub] = 0;
    groups[type][sub] += t.amount || 0;
  });

  let html = '<table class="data-table"><thead><tr><th>Category</th><th>Sub-category</th><th class="r">Amount</th><th class="r">% Rev</th></tr></thead><tbody>';
  const revenue = Object.values(groups.Revenue || {}).reduce((s,v)=>s+v,0) || 1;

  Object.entries(groups).forEach(([type, subs]) => {
    const typeTotal = Object.values(subs).reduce((s,v)=>s+v,0);
    html += `<tr class="section-header"><td colspan="2"><strong>${type}</strong></td><td class="r"><strong>${this.fmt(typeTotal)}</strong></td><td class="r">${(typeTotal/revenue*100).toFixed(1)}%</td></tr>`;
    Object.entries(subs).forEach(([sub, amt]) => {
      html += `<tr><td></td><td>${sub}</td><td class="r">${this.fmt(amt)}</td><td class="r">${(amt/revenue*100).toFixed(1)}%</td></tr>`;
    });
  });

  html += '</tbody></table>';
  container.innerHTML = html;
},
```

- [ ] **Step 5: Implement `_renderPnlByEntity(range)` — parallel fetches per entity**

```js
async _renderPnlByEntity(range) {
  const ENTITIES = ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS'];
  const container = document.getElementById('pnlReport');
  container.innerHTML = '<p style="color:var(--text3)">Loading by-entity data…</p>';

  const results = await Promise.all(ENTITIES.map(e => this.fetchReportData(e, range)));

  // Build a category → entity map
  const cats = ['Revenue','COGS','Gross Profit','Operating Expenses','Net Income'];
  const entityTotals = {};
  ENTITIES.forEach((e, i) => {
    const d = results[i];
    entityTotals[e] = this._summarizePnlData(d);
  });

  let html = `<table class="data-table"><thead><tr><th>Category</th>${ENTITIES.map(e=>`<th class="r">${e}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>`;
  cats.forEach(cat => {
    const row = ENTITIES.map(e => entityTotals[e]?.[cat] || 0);
    const total = row.reduce((s,v)=>s+v,0);
    html += `<tr><td>${cat}</td>${row.map(v=>`<td class="r">${this.fmt(v)}</td>`).join('')}<td class="r"><strong>${this.fmt(total)}</strong></td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
},

_summarizePnlData(data) {
  // Returns { Revenue, COGS, 'Gross Profit', 'Operating Expenses', 'Net Income' }
  if (!data) return {};
  const txns = data.txns || [];
  const rev  = txns.filter(t=>t.accounts?.account_type==='Revenue').reduce((s,t)=>s+t.amount,0);
  const cogs = txns.filter(t=>t.accounts?.account_type==='COGS').reduce((s,t)=>s+Math.abs(t.amount),0);
  const opex = txns.filter(t=>t.accounts?.account_type==='Expense'&&t.accounts?.account_subtype!=='COGS').reduce((s,t)=>s+Math.abs(t.amount),0);
  const gp   = rev - cogs;
  return { Revenue: rev, COGS: cogs, 'Gross Profit': gp, 'Operating Expenses': opex, 'Net Income': gp - opex };
},
```

- [ ] **Step 6: Implement `_renderPnlVsPrior(data, range)` — shift range back 12 months for prior year**

```js
async _renderPnlVsPrior(data, range) {
  const container = document.getElementById('pnlReport');
  container.innerHTML = '<p style="color:var(--text3)">Loading prior year…</p>';

  const shift = d => {
    const dt = new Date(d); dt.setFullYear(dt.getFullYear()-1);
    return dt.toISOString().slice(0,10);
  };
  const priorRange = { from: shift(range.from), to: shift(range.to) };
  const priorData = await this.fetchReportData(state.globalEntity, priorRange);

  const curr = this._summarizePnlData(data);
  const prior = this._summarizePnlData(priorData);
  const cats = ['Revenue','COGS','Gross Profit','Operating Expenses','Net Income'];

  let html = '<table class="data-table"><thead><tr><th>Category</th><th class="r">Current</th><th class="r">Prior Yr</th><th class="r">$ Var</th><th class="r">% Var</th></tr></thead><tbody>';
  cats.forEach(cat => {
    const c = curr[cat] || 0;
    const p = prior[cat] || 0;
    const varD = c - p;
    const varP = p !== 0 ? (varD/Math.abs(p)*100).toFixed(1)+'%' : '—';
    const cls = varD >= 0 ? 'g' : 'r';
    html += `<tr><td>${cat}</td><td class="r">${this.fmt(c)}</td><td class="r">${this.fmt(p)}</td><td class="r ${cls}">${this.fmt(varD)}</td><td class="r ${cls}">${varP}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
},
```

- [ ] **Step 7: Implement `_renderPnlVsBudget(data)` — compare against `_plBudget` seed**

```js
_renderPnlVsBudget(data) {
  const container = document.getElementById('pnlReport');
  const curr = this._summarizePnlData(data);
  const bgt = window._plBudget || {};

  const cats = [
    { label: 'Revenue',              key: 'Revenue',              bKey: 'revenue'             },
    { label: 'COGS',                 key: 'COGS',                 bKey: 'cogs'                },
    { label: 'Gross Profit',         key: 'Gross Profit',         bKey: 'gross_profit'        },
    { label: 'Operating Expenses',   key: 'Operating Expenses',   bKey: 'operating_expenses'  },
    { label: 'Net Income',           key: 'Net Income',           bKey: 'net_income'          },
  ];

  let html = '<table class="data-table"><thead><tr><th>Category</th><th class="r">Actual</th><th class="r">Budget</th><th class="r">$ Var</th><th class="r">% Var</th></tr></thead><tbody>';
  cats.forEach(({ label, key, bKey }) => {
    const actual = curr[key] || 0;
    const budget = bgt[bKey] ?? null;
    const varD = budget !== null ? actual - budget : null;
    const varP = (budget && varD !== null) ? (varD/Math.abs(budget)*100).toFixed(1)+'%' : '—';
    const cls  = varD !== null ? (varD >= 0 ? 'g' : 'r') : '';
    html += `<tr><td>${label}</td><td class="r">${this.fmt(actual)}</td><td class="r">${budget !== null ? this.fmt(budget) : '—'}</td><td class="r ${cls}">${varD !== null ? this.fmt(varD) : '—'}</td><td class="r ${cls}">${varP}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
},
```

- [ ] **Step 8: Verify all 5 modes in browser — click each tab, confirm correct columns render, no JS errors**

- [ ] **Step 9: Commit**

```bash
git add app.js
git commit -m "feat: P&L 5 view modes (Summary, Detail, By Entity, vs Prior Year, vs Budget)"
```

---

## Task 3: P&L Charts — Waterfall + Margin Trend

**Files:**
- Modify: `index.html` — add two chart canvas elements below `#pnlReport`
- Modify: `styles.css` — chart wrapper sizing
- Modify: `app.js` — `_renderPnlCharts(data, range)`

- [ ] **Step 1: Add chart containers in index.html below `#pnlReport`**

```html
<div class="pnl-charts-grid">
  <div class="card">
    <div class="card-header"><span class="card-title">P&L Waterfall</span></div>
    <div class="chart-wrap" style="height:240px"><canvas id="pnlWaterfallChart"></canvas></div>
  </div>
  <div class="card">
    <div class="card-header"><span class="card-title">12-Month Net Margin Trend</span></div>
    <div class="chart-wrap" style="height:240px"><canvas id="pnlMarginChart"></canvas></div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.pnl-charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
@media (max-width: 768px) { .pnl-charts-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Implement `_renderPnlCharts(data, range)` in app.js**

```js
async _renderPnlCharts(data, range) {
  const summary = this._summarizePnlData(data);

  // --- Waterfall Chart ---
  const wfEl = document.getElementById('pnlWaterfallChart');
  if (wfEl) {
    const rev  = summary.Revenue || 0;
    const cogs = summary.COGS || 0;
    const gp   = summary['Gross Profit'] || 0;
    const opex = summary['Operating Expenses'] || 0;
    const net  = summary['Net Income'] || 0;

    // Floating bars: [start, end]
    const wfData = [
      [0, rev],
      [rev - cogs, rev],
      [opex, gp],
      [0, net],
    ];
    const wfColors = ['#3b82f6', rev-cogs >= 0 ? '#22c55e' : '#ef4444', '#f59e0b', net >= 0 ? '#22c55e' : '#ef4444'];

    if (state.charts.pnlWaterfall) state.charts.pnlWaterfall.destroy();
    state.charts.pnlWaterfall = new Chart(wfEl, {
      type: 'bar',
      data: {
        labels: ['Revenue','COGS','Op. Expenses','Net Income'],
        datasets: [{ data: wfData, backgroundColor: wfColors, borderRadius: 4 }]
      },
      options: {
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => this.fmt(ctx.raw[1] - ctx.raw[0]) }
        }},
        scales: { y: { ticks: { callback: v => this.fmtM(v) } } }
      }
    });
  }

  // --- 12-Month Margin Trend Chart ---
  const marginEl = document.getElementById('pnlMarginChart');
  if (marginEl) {
    // Build 12 YYYY-MM-DD ranges going back 12 months from range.to
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(range.to);
      d.setMonth(d.getMonth() - i);
      const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0');
      months.push({ label: `${y}-${m}`, from: `${y}-${m}-01`, to: `${y}-${m}-31` });
    }

    const marginData = await Promise.all(months.map(async mo => {
      const d = await this.fetchReportData(state.globalEntity, mo);
      const s = this._summarizePnlData(d);
      const rev = s.Revenue || 0;
      return rev > 0 ? ((s['Net Income'] || 0) / rev * 100) : 0;
    }));

    if (state.charts.pnlMargin) state.charts.pnlMargin.destroy();
    state.charts.pnlMargin = new Chart(marginEl, {
      type: 'line',
      data: {
        labels: months.map(m => m.label),
        datasets: [{ label: 'Net Margin %', data: marginData, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.3, pointRadius: 3 }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { callback: v => v.toFixed(1)+'%' } }
        }
      }
    });
  }
},
```

- [ ] **Step 4: Verify in browser — both charts render on P&L page in all 5 modes**

- [ ] **Step 5: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: P&L waterfall + 12-month margin trend charts"
```

---

## Task 4: Balance Sheet — 2-Column + Ratio Cards + RE Waterfall

**Files:**
- Modify: `index.html` — restructure `#page-balance` (or `#page-balance-sheet`) to 2-col + add ratio card row + RE chart canvas
- Modify: `styles.css` — `.two-col-bs`, `.bs-ratio-row`
- Modify: `app.js` — update balance sheet render function

- [ ] **Step 1: Find the balance sheet page in index.html**

Search for `id="page-balance"`. Note existing structure inside it.

- [ ] **Step 2: Add ratio card row HTML inside `#page-balance`**

At the top of the page content, before the table, add:

```html
<div class="bs-ratio-row" id="bsRatioRow">
  <div class="metric-card">
    <div class="metric-label">Current Ratio</div>
    <div class="metric-value" id="bsCurrentRatio">—</div>
    <div class="metric-delta">Current Assets ÷ Current Liabilities</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Debt-to-Equity</div>
    <div class="metric-value" id="bsDebtEquity">—</div>
    <div class="metric-delta">Total Liabilities ÷ Total Equity</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Quick Ratio</div>
    <div class="metric-value" id="bsQuickRatio">—</div>
    <div class="metric-delta">(Current Assets − Inventory) ÷ Current Liabilities</div>
  </div>
</div>
```

- [ ] **Step 3: Wrap the BS table in a 2-column layout**

The existing balance sheet render produces a single-column table. Wrap the content area in:

```html
<div class="two-col-bs" id="bsTwoCol">
  <div id="bsAssetsCol"></div>
  <div id="bsLiabEquityCol"></div>
</div>
```

The JS render function will populate each column separately.

- [ ] **Step 4: Add RE waterfall chart canvas below the table**

```html
<div class="card" style="margin-top:16px">
  <div class="card-header"><span class="card-title">Retained Earnings Waterfall</span></div>
  <div class="chart-wrap" style="height:200px"><canvas id="bsReChart"></canvas></div>
</div>
```

- [ ] **Step 5: Add CSS**

```css
/* ---- BALANCE SHEET ---- */
.bs-ratio-row {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;
}
.two-col-bs { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 768px) {
  .bs-ratio-row { grid-template-columns: 1fr 1fr; }
  .two-col-bs { grid-template-columns: 1fr; }
}
```

- [ ] **Step 6: Update balance sheet render function in app.js**

Find the function that renders `#page-balance` content. Add at the end:

```js
// --- Ratio Cards ---
const bsData = this._parseBsData(data); // returns { currentAssets, currentLiabilities, totalLiabilities, totalEquity, inventory }
const setRatio = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
const safeDivide = (a, b) => b !== 0 ? (a/b).toFixed(2) : '—';

setRatio('bsCurrentRatio', safeDivide(bsData.currentAssets, bsData.currentLiabilities));
setRatio('bsDebtEquity',   safeDivide(bsData.totalLiabilities, bsData.totalEquity));
setRatio('bsQuickRatio',   safeDivide(bsData.currentAssets - bsData.inventory, bsData.currentLiabilities));

// --- RE Waterfall ---
const reEl = document.getElementById('bsReChart');
if (reEl) {
  const priorRE     = bsData.priorRE || 0;
  const netIncome   = bsData.netIncome || 0;
  const distrib     = bsData.distributions || 0;
  const currentRE   = priorRE + netIncome - distrib;
  if (state.charts.bsRe) state.charts.bsRe.destroy();
  state.charts.bsRe = new Chart(reEl, {
    type: 'bar',
    data: {
      labels: ['Prior RE','Net Income','Distributions','Current RE'],
      datasets: [{
        data: [[0,priorRE],[priorRE,priorRE+netIncome],[priorRE+netIncome-distrib,priorRE+netIncome],[0,currentRE]],
        backgroundColor: ['#3b82f6','#22c55e','#ef4444','#7c3aed'], borderRadius: 4
      }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => this.fmtM(v) } } } }
  });
}
```

Add a `_parseBsData(data)` helper that extracts the needed line items from the fetch result. Return safe defaults if data is missing:

```js
_parseBsData(data) {
  if (!data) return { currentAssets:0, currentLiabilities:0, totalLiabilities:0, totalEquity:0, inventory:0, priorRE:0, netIncome:0, distributions:0 };
  const txns = data.txns || [];
  const sum = type => txns.filter(t=>t.accounts?.account_type===type).reduce((s,t)=>s+Math.abs(t.amount),0);
  return {
    currentAssets:      sum('Current Asset'),
    currentLiabilities: sum('Current Liability'),
    totalLiabilities:   sum('Current Liability') + sum('Long-term Liability'),
    totalEquity:        sum('Equity'),
    inventory:          txns.filter(t=>t.accounts?.account_subtype==='Inventory').reduce((s,t)=>s+Math.abs(t.amount),0),
    priorRE:            0,   // use seed or journal_entries if available
    netIncome:          sum('Revenue') - sum('COGS') - sum('Expense'),
    distributions:      txns.filter(t=>t.accounts?.account_subtype==='Owner Distribution').reduce((s,t)=>s+Math.abs(t.amount),0),
  };
},
```

> Note: `account_type` values depend on how accounts are classified in the `accounts` Supabase table. Adjust the type strings to match what's actually in your data (check with a Supabase SELECT DISTINCT query on account_type if unsure).

- [ ] **Step 7: Split existing BS table render into Assets column (left) and Liabilities+Equity column (right)**

The existing render likely produces one large table. Modify it to produce two separate tables and write them to `#bsAssetsCol` and `#bsLiabEquityCol`.

- [ ] **Step 8: Verify in browser — 3 ratio cards show numeric values; 2-column layout renders Assets on left, Liabilities+Equity on right; RE waterfall chart renders below**

- [ ] **Step 9: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: Balance Sheet 2-col layout, ratio cards, RE waterfall chart"
```

---

## Task 5: Cash Flow — GAAP 3-Statement Structure

**Files:**
- Modify: `index.html` — restructure `#page-cashflow` with 3 `<details>` sections
- Modify: `styles.css` — `.cf-section` collapsible styles
- Modify: `app.js` — update `renderCashFlow()` to populate 3 sections

- [ ] **Step 1: Find the cash flow page in index.html**

Search for `id="page-cashflow"`. Note existing HTML structure.

- [ ] **Step 2: Replace inner content with 3-section structure**

```html
<div id="page-cashflow" class="page">
  <div id="cashflowTitle" class="page-title"></div>

  <details class="cf-section" open>
    <summary class="cf-section-title">Operating Activities</summary>
    <div class="tbl-wrap"><table class="data-table" id="cfOperating">
      <thead><tr><th>Item</th><th class="r">Amount</th></tr></thead>
      <tbody id="cfOperatingBody"></tbody>
      <tfoot><tr><td><strong>Net Operating</strong></td><td class="r" id="cfOperatingTotal"></td></tr></tfoot>
    </table></div>
  </details>

  <details class="cf-section">
    <summary class="cf-section-title">Investing Activities</summary>
    <div class="tbl-wrap"><table class="data-table" id="cfInvesting">
      <thead><tr><th>Item</th><th class="r">Amount</th></tr></thead>
      <tbody id="cfInvestingBody"></tbody>
      <tfoot><tr><td><strong>Net Investing</strong></td><td class="r" id="cfInvestingTotal"></td></tr></tfoot>
    </table></div>
  </details>

  <details class="cf-section">
    <summary class="cf-section-title">Financing Activities</summary>
    <div class="tbl-wrap"><table class="data-table" id="cfFinancing">
      <thead><tr><th>Item</th><th class="r">Amount</th></tr></thead>
      <tbody id="cfFinancingBody"></tbody>
      <tfoot><tr><td><strong>Net Financing</strong></td><td class="r" id="cfFinancingTotal"></td></tr></tfoot>
    </table></div>
  </details>

  <div class="cf-summary-row">
    <div class="cf-summary-item"><span>Net Change in Cash</span><strong id="cfNetChange">—</strong></div>
    <div class="cf-summary-item"><span>Ending Cash Balance</span><strong id="cfEndingBalance">—</strong></div>
  </div>
</div>
```

- [ ] **Step 3: Add CSS to styles.css**

```css
/* ---- CASH FLOW ---- */
.cf-section {
  border: 1px solid var(--border); border-radius: 8px;
  margin-bottom: 12px; overflow: hidden;
}
.cf-section-title {
  font-size: 0.85rem; font-weight: 700; padding: 12px 16px;
  cursor: pointer; background: var(--surface2);
  list-style: none; display: flex; align-items: center; gap: 8px;
}
.cf-section[open] .cf-section-title::before { content: '▾'; }
.cf-section:not([open]) .cf-section-title::before { content: '▸'; }
.cf-summary-row {
  display: flex; gap: 20px; padding: 16px;
  background: var(--surface2); border-radius: 8px;
  font-size: 0.85rem;
}
.cf-summary-item { display: flex; flex-direction: column; gap: 2px; }
.cf-summary-item strong { font-size: 1.1rem; font-weight: 700; }
```

- [ ] **Step 4: Update `renderCashFlow()` in app.js**

```js
async renderCashFlow() {
  const data = await this.fetchReportData(state.globalEntity, state.globalPeriodRange);
  if (!data) return;

  const txns = data.txns || [];

  // Categorize by account_subtype tags
  const operating   = txns.filter(t => !['investing','financing'].includes(t.accounts?.cash_flow_category?.toLowerCase()));
  const investing   = txns.filter(t => t.accounts?.cash_flow_category?.toLowerCase() === 'investing');
  const financing   = txns.filter(t => t.accounts?.cash_flow_category?.toLowerCase() === 'financing');

  const renderSection = (bodyId, totalId, items) => {
    const body  = document.getElementById(bodyId);
    const total = document.getElementById(totalId);
    if (!body || !total) return 0;
    const sum = items.reduce((s, t) => s + (t.amount || 0), 0);
    body.innerHTML = items.map(t =>
      `<tr><td>${t.accounts?.account_name || t.description || '—'}</td><td class="r">${this.fmt(t.amount)}</td></tr>`
    ).join('') || '<tr><td colspan="2" style="color:var(--text3)">No activity</td></tr>';
    total.textContent = this.fmt(sum);
    return sum;
  };

  const netOp  = renderSection('cfOperatingBody',  'cfOperatingTotal',  operating);
  const netInv = renderSection('cfInvestingBody',  'cfInvestingTotal',  investing);
  const netFin = renderSection('cfFinancingBody',  'cfFinancingTotal',  financing);

  const netChange = netOp + netInv + netFin;
  const priorBank = (window._bankAccounts || []).reduce((s, a) => s + a.balance, 0);
  const ending    = priorBank + netChange;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = this.fmt(val); };
  setEl('cfNetChange',     netChange);
  setEl('cfEndingBalance', ending);
},
```

- [ ] **Step 5: Call `renderCashFlow()` from `navigate()` when page is `cashflow`**

Check if `navigate()` already calls a cash flow render function. If so, replace/extend it. If not, add:

```js
case 'cashflow': await this.renderCashFlow(); break;
```

- [ ] **Step 6: Verify in browser — 3 collapsible sections appear; click each to expand/collapse; footer shows Net Change in Cash**

- [ ] **Step 7: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: Cash Flow GAAP 3-statement structure (Operating/Investing/Financing)"
```

---

## Task 6: Ratios — 3 New Charts

**Files:**
- Modify: `index.html` — add 3 chart canvas elements to `#page-ratios`
- Modify: `styles.css` — ratios chart grid
- Modify: `app.js` — `renderRatioCharts(data)`

- [ ] **Step 1: Find `#page-ratios` in index.html. Add chart containers below existing table**

```html
<div class="ratios-chart-grid">
  <div class="card">
    <div class="card-header"><span class="card-title">EBITDA Bridge</span></div>
    <div class="chart-wrap" style="height:220px"><canvas id="ebitdaChart"></canvas></div>
  </div>
  <div class="card">
    <div class="card-header"><span class="card-title">Budget vs Actual — Top Expenses</span></div>
    <div class="chart-wrap" style="height:220px"><canvas id="budgetActualChart"></canvas></div>
  </div>
  <div class="card span-2">
    <div class="card-header"><span class="card-title">12-Month Margin Trend</span></div>
    <div class="chart-wrap" style="height:200px"><canvas id="ratiosMarginChart"></canvas></div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.ratios-chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
.ratios-chart-grid .span-2 { grid-column: span 2; }
@media (max-width: 768px) { .ratios-chart-grid { grid-template-columns: 1fr; } .ratios-chart-grid .span-2 { grid-column: span 1; } }
```

- [ ] **Step 3: Implement `renderRatioCharts(data, range)` in app.js**

```js
async renderRatioCharts(data, range) {
  const summary = this._summarizePnlData(data);

  // --- EBITDA Bridge (floating bar waterfall) ---
  const ebitdaEl = document.getElementById('ebitdaChart');
  if (ebitdaEl) {
    const ebit  = (summary['Gross Profit'] || 0) - (summary['Operating Expenses'] || 0);
    const da    = (data.txns || []).filter(t => t.accounts?.account_subtype === 'Depreciation').reduce((s,t) => s + Math.abs(t.amount), 0);
    const ebitda = ebit + da;
    if (state.charts.ebitda) state.charts.ebitda.destroy();
    state.charts.ebitda = new Chart(ebitdaEl, {
      type: 'bar',
      data: {
        labels: ['EBIT','D&A Add-back','EBITDA'],
        datasets: [{ data: [[0,ebit],[ebit,ebit+da],[0,ebitda]], backgroundColor: ['#3b82f6','#22c55e','#7c3aed'], borderRadius: 4 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => this.fmtM(v) } } } }
    });
  }

  // --- Budget vs Actual (horizontal bar) ---
  const baEl = document.getElementById('budgetActualChart');
  if (baEl && window._plBudget) {
    const cats = ['revenue','cogs','gross_profit','operating_expenses','net_income'];
    const labels = ['Revenue','COGS','Gross Profit','Op. Expenses','Net Income'];
    const actuals = [summary.Revenue, summary.COGS, summary['Gross Profit'], summary['Operating Expenses'], summary['Net Income']].map(v=>Math.abs(v||0));
    const budgets = cats.map(k => Math.abs(window._plBudget[k] || 0));
    if (state.charts.budgetActual) state.charts.budgetActual.destroy();
    state.charts.budgetActual = new Chart(baEl, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Actual', data: actuals, backgroundColor: '#3b82f6', borderRadius: 4 },
          { label: 'Budget', data: budgets, backgroundColor: 'rgba(148,163,184,0.4)', borderRadius: 4 }
        ]
      },
      options: { indexAxis: 'y', plugins: { legend: { display: true } }, scales: { x: { ticks: { callback: v => this.fmtM(v) } } } }
    });
  }

  // --- 12-Month Margin Trend (3 lines) ---
  const marginEl = document.getElementById('ratiosMarginChart');
  if (marginEl) {
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(range.to); d.setMonth(d.getMonth()-i);
      const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0');
      months.push({ label: `${y}-${m}`, from: `${y}-${m}-01`, to: `${y}-${m}-31` });
    }
    const monthData = await Promise.all(months.map(mo => this.fetchReportData(state.globalEntity, mo)));
    const calcMargin = (d, type) => {
      const s = this._summarizePnlData(d);
      const rev = s.Revenue || 1;
      if (type === 'gross') return (s['Gross Profit']||0)/rev*100;
      if (type === 'operating') return ((s['Gross Profit']||0)-(s['Operating Expenses']||0))/rev*100;
      return (s['Net Income']||0)/rev*100;
    };
    if (state.charts.ratiosMargin) state.charts.ratiosMargin.destroy();
    state.charts.ratiosMargin = new Chart(marginEl, {
      type: 'line',
      data: {
        labels: months.map(m=>m.label),
        datasets: [
          { label: 'Gross Margin %',     data: monthData.map(d=>calcMargin(d,'gross')),     borderColor:'#22c55e', fill:false, tension:0.3 },
          { label: 'Operating Margin %', data: monthData.map(d=>calcMargin(d,'operating')), borderColor:'#3b82f6', fill:false, tension:0.3 },
          { label: 'Net Margin %',       data: monthData.map(d=>calcMargin(d,'net')),       borderColor:'#7c3aed', fill:false, tension:0.3 }
        ]
      },
      options: { plugins: { legend: { display: true, position: 'top' } }, scales: { y: { ticks: { callback: v => v.toFixed(1)+'%' } } } }
    });
  }
},
```

- [ ] **Step 4: Call `renderRatioCharts(data, range)` from the ratios page render function**

Find where `navigate('ratios')` leads in app.js. After existing ratios render, add: `await this.renderRatioCharts(data, state.globalPeriodRange);`

- [ ] **Step 5: Verify in browser — Ratios page shows 3 charts below existing KPI table; EBITDA bridge, budget vs actual horizontal bars, and 3-line margin trend all render**

- [ ] **Step 6: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: Ratios page — EBITDA bridge, budget vs actual, 12-month margin trend charts"
```

---

## Sprint 2 QA Checklist

- [ ] P&L Summary mode: Category / Amount / % Revenue columns render
- [ ] P&L Detail mode: Category + Sub-category rows with expanded breakdown
- [ ] P&L By Entity mode: 7 entity columns + Total, data loads (may show zeros if no Supabase data for entity)
- [ ] P&L vs Prior Year mode: Current / Prior Yr / $ Var / % Var columns; green for positive variance
- [ ] P&L vs Budget mode: Actual / Budget / $ Var / % Var columns; uses `_plBudget` seed values
- [ ] P&L waterfall chart renders below table in all modes
- [ ] P&L margin trend chart renders 12-month line
- [ ] Balance Sheet 2-column layout: Assets left, Liabilities+Equity right
- [ ] Balance Sheet 3 ratio cards show numeric values (not "—") when BS data exists
- [ ] Balance Sheet RE waterfall chart renders
- [ ] Cash Flow 3 `<details>` sections are collapsible; Operating open by default
- [ ] Cash Flow footer shows Net Change in Cash and Ending Cash Balance
- [ ] Ratios EBITDA bridge waterfall renders (3 bars)
- [ ] Ratios Budget vs Actual horizontal bar renders with Actual + Budget series
- [ ] Ratios 12-month margin trend shows 3 color-coded lines
- [ ] Global filter bar period/entity changes re-render all of the above pages correctly
- [ ] Dark mode: all chart labels and grid lines readable
