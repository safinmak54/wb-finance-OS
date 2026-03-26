# Sprint 3 — New & Enhanced Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 7 new/enhanced features: AP/Payables (new Supabase tab), Reconciliation (Supabase persistence), CFO Notes (6 formal notes with localStorage), Sales (live banner + charts), Product Mix (ad platform + channel charts), Cash Forecast (editable table), and Invoices (AR aging).

**Architecture:** Each feature is independent. Build them in order — AP first (establishes Supabase pattern), then Recon (extends pattern with matching logic), then all remaining features which are localStorage or Supabase read-only.

**Prerequisites:** Sprint 1 and Sprint 2 complete. Supabase credentials configured.

**Tech Stack:** Supabase REST (new tables: `ap_items`, `reconciliation_matches`), Chart.js 4.4.1, localStorage, vanilla JS

---

## File Map

| File | What changes |
|---|---|
| `app.js` | `renderAP()`, `payApItem()`, `disputeApItem()`; `renderReconcile()` augmentation, `autoMatch()`, `manualMatch()`; `renderCfoNotes()`, `saveCfoNote()`; `renderSales()` + charts; `renderProductMix()` + charts + seed; `renderForecast()` editable table; `renderInvoices()` aging columns + grid |
| `index.html` | AP page div + nav item; Reconcile page augmented; CFO Notes augmented; Sales, Product Mix, Forecast, Invoice aging grid |
| `styles.css` | `.ap-kpi-row`, `.aging-grid`, `.aging-chip`, `.recon-split`, `.recon-summary`, `.cfr-note-card`, `.sales-live-banner`, `.forecast-table`, print styles |

---

## Task 1: Create Supabase Tables

**No code files modified — run SQL in Supabase dashboard.**

- [ ] **Step 1: Create `ap_items` table**

In Supabase → SQL Editor, run:

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

-- Enable RLS (use your existing policy pattern)
alter table ap_items enable row level security;
create policy "Allow all for authenticated" on ap_items for all using (true);
```

- [ ] **Step 2: Create `reconciliation_matches` table**

```sql
create table reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  statement_txn_id text unique,   -- unique required for upsert onConflict to work
  book_txn_id uuid references transactions(id),
  entity text,
  amount numeric(12,2),
  match_status text default 'unmatched'
    check (match_status in ('matched','unmatched','pending','disputed')),
  matched_at timestamptz,
  created_at timestamptz default now()
);

alter table reconciliation_matches enable row level security;
create policy "Allow all for authenticated" on reconciliation_matches for all using (true);
```

- [ ] **Step 3: Seed `ap_items` with test data so the UI renders**

```sql
insert into ap_items (entity, vendor, invoice_date, due_date, amount, paid) values
  ('WBP',  'PrintCo',      '2026-02-15', '2026-03-15', 12400.00, false),
  ('LP',   'LogoSupply',   '2026-02-20', '2026-03-01', 3200.00,  false),
  ('KP',   'Printworks',   '2026-01-10', '2026-02-10', 8700.00,  false),
  ('BP',   'OfficeMax',    '2026-03-01', '2026-03-30', 1850.00,  false),
  ('SWAG', 'VendorOne',    '2026-01-05', '2026-02-05', 22000.00, false),
  ('WBP',  'Amazon Biz',   '2026-03-10', '2026-04-10', 4500.00,  false),
  ('RUSH', 'FastPrint',    '2026-02-28', '2026-03-28', 6300.00,  false);
```

- [ ] **Step 4: Verify tables exist — in Supabase dashboard, check Table Editor shows both tables with data**

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "docs: Supabase tables ap_items + reconciliation_matches created (SQL run in dashboard)"
```

---

## Task 2: AP/Payables Tab

**Files:**
- Modify: `index.html` — add `#page-ap` div + nav item
- Modify: `styles.css` — AP page styles
- Modify: `app.js` — `renderAP()`, `payApItem()`, `disputeApItem()`, `agingBucket()`

- [ ] **Step 1: Add AP nav item in index.html sidebar**

Find the sidebar nav list. Add after the Invoices item:

```html
<li class="nav-item" data-page="ap" data-roles="coo cpa admin" onclick="app.navigate('ap')" style="display:none">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
  <span class="nav-label">AP / Payables</span>
</li>
```

- [ ] **Step 2: Add `#page-ap` page div in index.html**

After the Invoices page div, add:

```html
<!-- AP / PAYABLES PAGE -->
<div id="page-ap" class="page">
  <div class="ap-kpi-row" id="apKpiRow">
    <div class="metric-card"><div class="metric-label">Total Outstanding</div><div class="metric-value" id="apTotal">—</div></div>
    <div class="metric-card"><div class="metric-label">Overdue</div><div class="metric-value r" id="apOverdue">—</div></div>
    <div class="metric-card"><div class="metric-label">Due This Week</div><div class="metric-value" id="apDueWeek">—</div></div>
    <div class="metric-card"><div class="metric-label">Avg Days to Pay</div><div class="metric-value" id="apAvgDays">—</div></div>
  </div>
  <div class="aging-grid" id="apAgingGrid"></div>
  <div class="card" style="margin-top:12px">
    <div class="card-header">
      <span class="card-title">Payables Detail</span>
      <div style="display:flex;gap:8px;margin-left:auto">
        <select id="apVendorFilter" onchange="app.filterApTable()" style="font-size:0.75rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface)">
          <option value="">All Vendors</option>
        </select>
      </div>
    </div>
    <div class="tbl-wrap">
      <table class="data-table">
        <thead><tr><th>Vendor</th><th>Entity</th><th>Invoice Date</th><th>Due Date</th><th class="r">Amount</th><th>Aging</th><th>Actions</th></tr></thead>
        <tbody id="apTableBody"></tbody>
      </table>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add CSS to styles.css**

```css
/* ---- AP / PAYABLES ---- */
.ap-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
@media (max-width: 768px) { .ap-kpi-row { grid-template-columns: 1fr 1fr; } }

.aging-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 12px;
}
.aging-cell {
  background: var(--surface2); border-radius: 8px; padding: 10px 12px;
  cursor: pointer; text-align: center; transition: background 0.12s;
  border: 2px solid transparent;
}
.aging-cell:hover { border-color: var(--accent); }
.aging-cell.active { border-color: var(--accent); background: rgba(59,130,246,0.08); }
.aging-cell-label { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text3); margin-bottom: 4px; }
.aging-cell-val { font-size: 1rem; font-weight: 700; color: var(--text); }
.aging-cell-count { font-size: 0.68rem; color: var(--text3); margin-top: 2px; }

.aging-chip {
  display: inline-block; font-size: 0.65rem; font-weight: 700;
  padding: 2px 8px; border-radius: 6px; text-transform: uppercase;
}
.aging-chip.current  { background: rgba(34,197,94,0.12);  color: #16a34a; }
.aging-chip.low      { background: rgba(245,158,11,0.12); color: #b45309; }
.aging-chip.medium   { background: rgba(249,115,22,0.12); color: #c2410c; }
.aging-chip.high     { background: rgba(239,68,68,0.12);  color: #dc2626; }
.aging-chip.critical { background: rgba(127,29,29,0.15);  color: #991b1b; }

.ap-action-btn {
  font-size: 0.7rem; padding: 3px 8px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--border); background: transparent; color: var(--text2);
}
.ap-action-btn:hover { background: var(--border2); }
.ap-action-btn.pay { color: #16a34a; border-color: #16a34a; }
.ap-action-btn.pay:hover { background: rgba(22,163,74,0.08); }
```

- [ ] **Step 4: Add `agingBucket()` helper to app.js (shared with Invoices in Task 8)**

```js
agingBucket(dueDateStr) {
  if (!dueDateStr) return { label: '—', cls: '' };
  const days = Math.floor((Date.now() - new Date(dueDateStr)) / 86400000);
  if (days < 0)   return { label: 'Current',  cls: 'current',  days };
  if (days <= 30) return { label: '1-30 Days', cls: 'low',     days };
  if (days <= 60) return { label: '31-60 Days',cls: 'medium',  days };
  if (days <= 90) return { label: '61-90 Days',cls: 'high',    days };
  return            { label: '90+ Days',  cls: 'critical', days };
},
```

- [ ] **Step 5: Add `renderAP()` to app.js**

```js
async renderAP() {
  const entity = state.globalEntity;
  let query = supabaseClient.from('ap_items').select('*').eq('paid', false).order('due_date');
  if (entity !== 'all') query = query.eq('entity', entity);
  const { data: items, error } = await query;
  if (error) { console.error('AP fetch:', error); return; }

  this._apItems = items || [];
  this._apBucketFilter = null;
  this._renderApUI(this._apItems);
},

_renderApUI(items) {
  const now = Date.now();
  const weekMs = 7 * 86400000;

  // KPIs
  const total    = items.reduce((s,i) => s + i.amount, 0);
  const overdue  = items.filter(i => new Date(i.due_date) < new Date()).reduce((s,i) => s+i.amount, 0);
  const dueWeek  = items.filter(i => { const d=new Date(i.due_date); return d>=new Date() && d<=new Date(now+weekMs); }).reduce((s,i)=>s+i.amount,0);
  const avgDays  = items.length ? Math.round(items.reduce((s,i)=>s+this.agingBucket(i.due_date).days,0)/items.length) : 0;

  const set = (id, val) => { const el=document.getElementById(id); if (el) el.textContent=val; };
  set('apTotal',   this.fmt(total));
  set('apOverdue', this.fmt(overdue));
  set('apDueWeek', this.fmt(dueWeek));
  set('apAvgDays', avgDays + ' days');

  // Aging grid
  const buckets = ['current','low','medium','high','critical'];
  const labels  = ['Current','1-30 Days','31-60 Days','61-90 Days','90+ Days'];
  const bktData = {};
  buckets.forEach(b => { bktData[b] = { count: 0, total: 0 }; });
  items.forEach(i => { const b = this.agingBucket(i.due_date); if (bktData[b.cls]) { bktData[b.cls].count++; bktData[b.cls].total += i.amount; } });

  const agingGrid = document.getElementById('apAgingGrid');
  if (agingGrid) {
    agingGrid.innerHTML = buckets.map((b, i) => `
      <div class="aging-cell ${b === this._apBucketFilter ? 'active' : ''}" onclick="app.filterApByBucket('${b}')">
        <div class="aging-cell-label">${labels[i]}</div>
        <div class="aging-cell-val">${this.fmt(bktData[b].total)}</div>
        <div class="aging-cell-count">${bktData[b].count} invoice${bktData[b].count!==1?'s':''}</div>
      </div>`).join('');
  }

  // Vendor filter
  const vendorSel = document.getElementById('apVendorFilter');
  if (vendorSel) {
    const vendors = [...new Set(items.map(i=>i.vendor))].sort();
    vendorSel.innerHTML = '<option value="">All Vendors</option>' + vendors.map(v=>`<option value="${v}">${v}</option>`).join('');
  }

  // Table
  const body = document.getElementById('apTableBody');
  if (!body) return;
  if (!items.length) { body.innerHTML = '<tr><td colspan="7" style="color:var(--text3);text-align:center;padding:24px">No outstanding payables</td></tr>'; return; }
  body.innerHTML = items.map(item => {
    const aging = this.agingBucket(item.due_date);
    return `<tr>
      <td>${item.vendor}</td>
      <td>${item.entity}</td>
      <td>${item.invoice_date || '—'}</td>
      <td>${item.due_date}</td>
      <td class="r">${this.fmt(item.amount)}</td>
      <td><span class="aging-chip ${aging.cls}">${aging.label}</span></td>
      <td>
        <button class="ap-action-btn pay" onclick="app.payApItem('${item.id}')">Pay</button>
        <button class="ap-action-btn" onclick="app.disputeApItem('${item.id}')">Dispute</button>
      </td>
    </tr>`;
  }).join('');
},

filterApByBucket(bucket) {
  this._apBucketFilter = this._apBucketFilter === bucket ? null : bucket;
  const filtered = this._apBucketFilter
    ? this._apItems.filter(i => this.agingBucket(i.due_date).cls === this._apBucketFilter)
    : this._apItems;
  this._renderApUI(filtered);
},

filterApTable() {
  const vendor = document.getElementById('apVendorFilter')?.value;
  const filtered = vendor ? this._apItems.filter(i=>i.vendor===vendor) : this._apItems;
  this._renderApUI(filtered);
},

async payApItem(id) {
  const { error } = await supabaseClient.from('ap_items').update({ paid: true }).eq('id', id);
  if (error) { this.showToast('Error updating payment', 'error'); return; }
  this.showToast('Invoice marked as paid', 'success');
  await this.renderAP();
},

async disputeApItem(id) {
  const note = prompt('Enter dispute note:');
  if (note === null) return;
  const { error } = await supabaseClient.from('ap_items').update({ dispute_note: note }).eq('id', id);
  if (error) { this.showToast('Error saving dispute', 'error'); return; }
  this.showToast('Dispute note saved', 'success');
},
```

- [ ] **Step 6: Call `renderAP()` from `navigate()` when page is `ap`**

- [ ] **Step 7: Verify in browser — AP page shows 4 KPI cards, 5 aging bucket cells (clickable to filter), vendor dropdown, and payables table. Click Pay on an item — disappears from list. Click Dispute — prompt appears, note saved.**

- [ ] **Step 8: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: AP/Payables tab with Supabase fetch, aging grid, Pay/Dispute actions"
```

---

## Task 3: Reconciliation — Supabase Persistence + Auto-Match

**Files:**
- Modify: `index.html` — augment `#page-reconcile` with summary cards + auto-match button
- Modify: `styles.css` — `.recon-summary`
- Modify: `app.js` — augment existing `renderReconcile()` with Supabase writes, `autoMatch()`, `manualMatch()`

- [ ] **Step 1: Add summary cards + auto-match button to `#page-reconcile` in index.html**

At the top of the existing reconcile page content, before the two-column grid:

```html
<div class="recon-summary" id="reconSummary">
  <div class="metric-card"><div class="metric-label">Matched</div><div class="metric-value g" id="reconMatched">—</div></div>
  <div class="metric-card"><div class="metric-label">Unmatched</div><div class="metric-value r" id="reconUnmatched">—</div></div>
  <div class="metric-card"><div class="metric-label">Pending Review</div><div class="metric-value" id="reconPending">—</div></div>
  <div class="metric-card"><div class="metric-label">Disputed</div><div class="metric-value" id="reconDisputed">—</div></div>
  <button class="btn-primary" style="margin-left:auto" onclick="app.autoMatch()">⚡ Auto-Match</button>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.recon-summary {
  display: flex; gap: 12px; align-items: center;
  margin-bottom: 16px; flex-wrap: wrap;
}
.recon-summary .metric-card { flex: 1; min-width: 120px; }
```

- [ ] **Step 3: Add `autoMatch()` to app.js**

```js
async autoMatch() {
  const entity = state.globalEntity;
  const range  = state.globalPeriodRange;

  // Fetch raw_transactions (bank) and book transactions
  let bankQ = supabaseClient.from('raw_transactions').select('id, acc_date, description, amount, entity')
    .gte('acc_date', range.from).lte('acc_date', range.to);
  if (entity !== 'all') bankQ = bankQ.eq('entity', entity);
  const { data: bankTxns } = await bankQ;

  let bookQ = supabaseClient.from('transactions').select('id, acc_date, description, amount, entity')
    .gte('acc_date', range.from).lte('acc_date', range.to);
  if (entity !== 'all') bookQ = bookQ.eq('entity', entity);
  const { data: bookTxns } = await bookQ;

  if (!bankTxns || !bookTxns) return;

  const used = new Set();
  const inserts = [];

  bankTxns.forEach(bank => {
    const bankDate = new Date(bank.acc_date);
    const candidates = bookTxns.filter(book => {
      if (used.has(book.id)) return false;
      const bookDate = new Date(book.acc_date);
      const daysDiff = Math.abs((bankDate - bookDate) / 86400000);
      return Math.abs(bank.amount - book.amount) < 0.01 && daysDiff <= 3;
    });

    if (candidates.length === 1) {
      // Confident 1:1 match
      used.add(candidates[0].id);
      inserts.push({ statement_txn_id: String(bank.id), book_txn_id: candidates[0].id, entity: bank.entity || entity, amount: bank.amount, match_status: 'matched', matched_at: new Date().toISOString() });
    } else if (candidates.length > 1) {
      // Ambiguous — mark pending
      inserts.push({ statement_txn_id: String(bank.id), book_txn_id: null, entity: bank.entity || entity, amount: bank.amount, match_status: 'pending' });
    }
    // No match → leave unmatched (no insert)
  });

  if (inserts.length) {
    const { error } = await supabaseClient.from('reconciliation_matches').upsert(inserts, { onConflict: 'statement_txn_id' });
    if (error) { this.showToast('Auto-match error: ' + error.message, 'error'); return; }
  }

  this.showToast(`Auto-matched ${inserts.filter(i=>i.match_status==='matched').length} transactions`, 'success');
  await this.renderReconcile();
},
```

- [ ] **Step 4: Augment existing `renderReconcile()` to fetch matches and update summary cards**

At the start of the existing `renderReconcile()` function, insert this block to fetch existing matches, count them by status, and update summary cards:

```js
// --- Fetch existing matches for the current period ---
const entity = state.globalEntity;
const range  = state.globalPeriodRange;

let matchQ = supabaseClient.from('reconciliation_matches').select('id, statement_txn_id, book_txn_id, match_status, amount');
if (entity !== 'all') matchQ = matchQ.eq('entity', entity);
const { data: matches } = await matchQ;
const matchList = matches || [];

// Count by status
const counts = { matched:0, unmatched:0, pending:0, disputed:0 };
matchList.forEach(m => { if (counts[m.match_status] !== undefined) counts[m.match_status]++; });

// Update summary card elements
const setCard = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
setCard('reconMatched',   counts.matched);
setCard('reconUnmatched', counts.unmatched);
setCard('reconPending',   counts.pending);
setCard('reconDisputed',  counts.disputed);

// Build a lookup: statement_txn_id → match record (for coloring bank rows)
const bankMatchMap = {};
matchList.forEach(m => { bankMatchMap[m.statement_txn_id] = m; });
```

Then, in the bank table body render (where `#bankBody` rows are built), add a "Match" column cell that shows status:

```js
// Inside the bank row render loop — replace existing Match cell with:
const match = bankMatchMap[String(bank.id)];
const matchCell = match
  ? match.match_status === 'matched'
    ? `<span style="color:var(--green)">✓ Matched</span>`
    : match.match_status === 'pending'
    ? `<button class="ap-action-btn" onclick="app.confirmMatch('${match.id}')">Confirm</button>
       <button class="ap-action-btn" onclick="app.disputeMatch('${match.id}')">Dispute</button>`
    : match.match_status === 'disputed'
    ? `<span style="color:var(--red)">Disputed</span>`
    : '—'
  : '—';
// Inject matchCell into the Match <td> of this row
```

- [ ] **Step 5: Add `confirmMatch()` and `disputeMatch()` to app.js**

```js
async confirmMatch(matchId) {
  const { error } = await supabaseClient.from('reconciliation_matches')
    .update({ match_status: 'matched', matched_at: new Date().toISOString() })
    .eq('id', matchId);
  if (error) { this.showToast('Error confirming match', 'error'); return; }
  this.showToast('Match confirmed', 'success');
  await this.renderReconcile();
},
async disputeMatch(matchId) {
  const { error } = await supabaseClient.from('reconciliation_matches')
    .update({ match_status: 'disputed' })
    .eq('id', matchId);
  if (error) { this.showToast('Error disputing match', 'error'); return; }
  this.showToast('Match disputed', 'success');
  await this.renderReconcile();
},
```

- [ ] **Step 6: Verify in browser — Auto-Match button runs, success toast shows count. Summary cards update. Pending rows show Confirm/Dispute buttons.**

- [ ] **Step 7: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: Reconciliation auto-match with Supabase persistence, summary cards"
```

---

## Task 4: CFO Notes — 6 Formal Notes

**Files:**
- Modify: `app.js` — augment `renderCfoNotes()` to output 6 note cards with localStorage save
- Modify: `styles.css` — `.cfr-note-card`, `@media print`

The existing `renderCfoNotes()` function populates `#cfnotesContent`. We replace its output.

- [ ] **Step 1: Add CSS to styles.css**

```css
/* ---- CFO NOTES ---- */
.cfnotes-banner {
  background: #1E3A5F; color: #fff; border-radius: 10px;
  padding: 16px 20px; margin-bottom: 16px;
  display: flex; justify-content: space-between; align-items: flex-start;
}
.cfnotes-banner-title { font-size: 1rem; font-weight: 700; }
.cfnotes-banner-meta { font-size: 0.72rem; opacity: 0.75; margin-top: 4px; }
.cfnotes-disclaimer { font-size: 0.65rem; opacity: 0.6; margin-top: 8px; max-width: 400px; }
.cfnotes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 768px) { .cfnotes-grid { grid-template-columns: 1fr; } }
.cfr-note-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px 18px;
}
[data-theme="dark"] .cfr-note-card { background: var(--surface2); }
.cfr-note-title {
  font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--text3); margin-bottom: 8px;
}
.cfr-note-body {
  min-height: 80px; font-size: 0.82rem; color: var(--text);
  line-height: 1.6; outline: none;
  border-bottom: 1px solid var(--border); padding-bottom: 6px;
}
.cfr-note-body:empty::before { content: 'Click to add notes…'; color: var(--text3); font-style: italic; }
.cfnotes-print-btn { font-size: 0.75rem; padding: 6px 14px; }

@media print {
  #topbar, #sidebar, #globalFilterBar, .cfnotes-print-btn { display: none !important; }
  #page-cfnotes { padding: 0 !important; }
  .cfnotes-banner { -webkit-print-color-adjust: exact; }
}
```

- [ ] **Step 2: Replace `renderCfoNotes()` in app.js**

```js
renderCfoNotes() {
  const container = document.getElementById('cfnotesContent');
  if (!container) return;

  const entity = state.globalEntity === 'all' ? 'All Entities' : state.globalEntity;
  const period = this.getPeriodLabel(state.globalPeriod);
  const year   = state.globalPeriodRange.from.slice(0,4);
  const sem    = state.globalPeriod;

  const noteKey = (i) => `cfnote_${state.globalEntity}_${sem}_${year}_${i}`;

  const NOTES = [
    'Revenue Recognition',
    'Significant Transactions',
    'Contingent Liabilities',
    'Related Party Transactions',
    'Subsequent Events',
    'Going Concern / Liquidity',
  ];

  container.innerHTML = `
    <div class="cfnotes-banner">
      <div>
        <div class="cfnotes-banner-title">${entity} — Financial Statement Notes</div>
        <div class="cfnotes-banner-meta">Reporting Period: ${period} · Prepared by: Finance Team</div>
        <div class="cfnotes-disclaimer">These notes are an integral part of the financial statements and should be read in conjunction with the accompanying balance sheet, income statement, and cash flow statement.</div>
      </div>
      <button class="btn-outline cfnotes-print-btn" onclick="window.print()">⬜ Print / PDF</button>
    </div>
    <div class="cfnotes-grid">
      ${NOTES.map((title, i) => `
        <div class="cfr-note-card">
          <div class="cfr-note-title">Note ${i+1} — ${title}</div>
          <div class="cfr-note-body" contenteditable="true" id="cfNote${i}"
               onblur="app.saveCfoNote(${i})">${localStorage.getItem(noteKey(i)) || ''}</div>
        </div>`).join('')}
    </div>`;
},

saveCfoNote(i) {
  const el = document.getElementById(`cfNote${i}`);
  if (!el) return;
  const entity = state.globalEntity;
  const year   = state.globalPeriodRange.from.slice(0,4);
  const sem    = state.globalPeriod;
  localStorage.setItem(`cfnote_${entity}_${sem}_${year}_${i}`, el.innerHTML);
},
```

- [ ] **Step 3: Call `renderCfoNotes()` from `navigate()` when page is `cfnotes`**

Find the existing call in `navigate()` — it may already call `renderCfoNotes()`. Replace any prior implementation with the new one above.

- [ ] **Step 4: Verify in browser — CFO Notes shows executive banner with entity/period, 6 note cards in 2-column grid. Type in a card, navigate away, come back — content persists. Click Print — only note cards visible.**

- [ ] **Step 5: Commit**

```bash
git add app.js styles.css
git commit -m "feat: CFO Notes 6 formal note cards with localStorage persistence + print"
```

---

## Task 5: Sales — Live Banner + Weekly Chart + Monthly Table

**Files:**
- Modify: `index.html` — augment `#page-sales` with banner + chart canvas + table container
- Modify: `styles.css` — `.sales-live-banner`
- Modify: `app.js` — augment `renderSales()`

- [ ] **Step 1: Add content structure to `#page-sales` in index.html**

Wrap existing content or replace with:

```html
<div class="sales-live-banner" id="salesBanner">
  <div class="sales-banner-label">Revenue This Month</div>
  <div class="sales-banner-val" id="salesLiveVal">Loading…</div>
  <div class="sales-banner-sub" id="salesLiveSub"></div>
</div>
<div class="dash-grid" style="margin-top:16px">
  <div class="card span-2">
    <div class="card-header"><span class="card-title">Last 7 Days Revenue</span></div>
    <div class="chart-wrap" style="height:200px"><canvas id="salesWeeklyChart"></canvas></div>
  </div>
  <div class="card span-1">
    <div class="card-header"><span class="card-title">Monthly Performance</span></div>
    <div class="tbl-wrap"><table class="data-table" id="salesMonthlyTable"></table></div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.sales-live-banner {
  background: linear-gradient(135deg, #1E3A5F, #2563eb);
  color: #fff; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px;
}
.sales-banner-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; opacity: 0.75; }
.sales-banner-val { font-size: 2rem; font-weight: 800; margin: 6px 0 2px; }
.sales-banner-sub { font-size: 0.78rem; opacity: 0.75; }
```

- [ ] **Step 3: Augment `renderSales()` in app.js**

```js
async renderSales() {
  // Live banner — fetch current month revenue
  const now = new Date();
  const thisMonthFrom = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const today = now.toISOString().slice(0,10);
  const { data: revTxns } = await supabaseClient.from('transactions').select('amount, accounts(account_type)')
    .gte('acc_date', thisMonthFrom).lte('acc_date', today);
  const monthRev = (revTxns || []).filter(t=>t.accounts?.account_type==='Revenue').reduce((s,t)=>s+t.amount,0);
  const setEl = (id, val) => { const e=document.getElementById(id); if(e) e.textContent=val; };
  setEl('salesLiveVal', this.fmt(monthRev));
  setEl('salesLiveSub', `${this.getPeriodLabel(state.globalPeriod)} · ${state.globalEntity==='all'?'All Entities':state.globalEntity}`);

  // Weekly chart — last 7 days
  const days = [];
  for (let i=6; i>=0; i--) { const d=new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().slice(0,10)); }
  const { data: weekTxns } = await supabaseClient.from('transactions').select('amount, acc_date, accounts(account_type)')
    .gte('acc_date', days[0]).lte('acc_date', days[6]);
  const dayTotals = days.map(day => (weekTxns||[]).filter(t=>t.acc_date===day&&t.accounts?.account_type==='Revenue').reduce((s,t)=>s+t.amount,0));

  const weekEl = document.getElementById('salesWeeklyChart');
  if (weekEl) {
    if (state.charts.salesWeekly) state.charts.salesWeekly.destroy();
    state.charts.salesWeekly = new Chart(weekEl, {
      type: 'bar',
      data: { labels: days.map(d=>d.slice(5)), datasets: [{ data: dayTotals, backgroundColor: '#3b82f6', borderRadius: 4 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v=>this.fmtM(v) } } } }
    });
  }

  // Monthly table — current vs prior month vs budget
  const lastMonthD = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const lastMonthFrom = `${lastMonthD.getFullYear()}-${String(lastMonthD.getMonth()+1).padStart(2,'0')}-01`;
  const lastMonthTo   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0,10);
  const { data: priorTxns } = await supabaseClient.from('transactions').select('amount, accounts(account_type)')
    .gte('acc_date', lastMonthFrom).lte('acc_date', lastMonthTo);
  const priorRev  = (priorTxns||[]).filter(t=>t.accounts?.account_type==='Revenue').reduce((s,t)=>s+t.amount,0);
  const budget    = (window._plBudget?.revenue || 0) / 12;
  const varBgt    = budget > 0 ? ((monthRev-budget)/budget*100).toFixed(1) : '—';
  const varPrior  = priorRev > 0 ? ((monthRev-priorRev)/priorRev*100).toFixed(1) : '—';

  const tbl = document.getElementById('salesMonthlyTable');
  if (tbl) {
    tbl.innerHTML = `<thead><tr><th>Metric</th><th class="r">Current</th><th class="r">Prior Mo.</th><th class="r">Budget</th><th class="r">vs Budget</th></tr></thead>
    <tbody>
      <tr><td>Revenue</td><td class="r">${this.fmt(monthRev)}</td><td class="r">${this.fmt(priorRev)}</td><td class="r">${this.fmt(budget)}</td><td class="r ${parseFloat(varBgt)>=0?'g':'r'}">${varBgt}%</td></tr>
    </tbody>`;
  }
},
```

- [ ] **Step 4: Call `renderSales()` from `navigate()` for page `sales`**

- [ ] **Step 5: Verify in browser — Sales page shows blue gradient banner with current month revenue, 7-bar weekly chart, and monthly performance table**

- [ ] **Step 6: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: Sales page live revenue banner, weekly chart, monthly performance table"
```

---

## Task 6: Product Mix — Ad Platform + Channel Charts

**Files:**
- Modify: `app.js` — add `adSpend`/`channels` to seed, augment `renderProductMix()`
- Modify: `index.html` — augment `#page-productmix` with chart canvases
- Modify: `styles.css` — `.pm-kpi-row`

- [ ] **Step 1: Extend `_productMix` seed in app.js**

Find existing `window._productMix` seed. Add missing keys:

```js
if (window._productMix && !window._productMix.adSpend) {
  window._productMix.adSpend   = { meta: 18400, google: 12700, tiktok: 6200 };
  window._productMix.channels  = { online: 0.52, retail: 0.28, wholesale: 0.14, other: 0.06 };
  window._productMix.adRevenue = { meta: 112000, google: 88000, tiktok: 34000 };
}
```

- [ ] **Step 2: Add chart canvases to `#page-productmix` in index.html**

Below existing KPI cards, add:

```html
<div class="dash-grid" style="margin-top:16px">
  <div class="card span-2">
    <div class="card-header"><span class="card-title">Ad Platform — Spend vs Revenue</span></div>
    <div class="chart-wrap" style="height:220px"><canvas id="pmAdChart"></canvas></div>
  </div>
  <div class="card span-1">
    <div class="card-header"><span class="card-title">Revenue by Channel</span></div>
    <div class="chart-wrap" style="height:220px"><canvas id="pmChannelChart"></canvas></div>
  </div>
</div>
```

- [ ] **Step 3: Augment `renderProductMix()` in app.js**

```js
// After existing KPI render, add:
const pm = window._productMix;
if (!pm) return;

// Ad platform chart
const adEl = document.getElementById('pmAdChart');
if (adEl && pm.adSpend) {
  const platforms = ['Meta','Google','TikTok'];
  const spend   = [pm.adSpend.meta, pm.adSpend.google, pm.adSpend.tiktok];
  const revenue = [pm.adRevenue.meta, pm.adRevenue.google, pm.adRevenue.tiktok];
  if (state.charts.pmAd) state.charts.pmAd.destroy();
  state.charts.pmAd = new Chart(adEl, {
    type: 'bar',
    data: { labels: platforms, datasets: [
      { label: 'Spend', data: spend, backgroundColor: '#ef4444', borderRadius: 4 },
      { label: 'Revenue', data: revenue, backgroundColor: '#22c55e', borderRadius: 4 }
    ]},
    options: { plugins: { legend: { display: true, position: 'top' } }, scales: { y: { ticks: { callback: v=>this.fmtM(v) } } } }
  });
}

// Channel mix donut
const chEl = document.getElementById('pmChannelChart');
if (chEl && pm.channels) {
  const labels = ['Online','Retail','Wholesale','Other'];
  const vals   = [pm.channels.online, pm.channels.retail, pm.channels.wholesale, pm.channels.other].map(v=>Math.round(v*100));
  if (state.charts.pmChannel) state.charts.pmChannel.destroy();
  state.charts.pmChannel = new Chart(chEl, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: vals, backgroundColor: ['#3b82f6','#22c55e','#f59e0b','#94a3b8'], borderWidth: 2 }] },
    options: { plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw}%` } } } }
  });
}
```

- [ ] **Step 4: Verify in browser — Product Mix shows grouped bar for ad platforms and donut for channel mix**

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: Product Mix ad platform chart + channel mix donut"
```

---

## Task 7: Cash Forecast — Editable Monthly Table

**Files:**
- Modify: `index.html` — augment `#page-forecast`
- Modify: `styles.css` — `.forecast-table`
- Modify: `app.js` — augment `renderForecast()`

- [ ] **Step 1: Replace forecast page content in index.html**

```html
<div id="page-forecast" class="page">
  <div class="toolbar">
    <div class="toolbar-right">
      <button class="btn-outline" onclick="app.resetForecast()">Reset</button>
      <button class="btn-outline" onclick="app.exportForecast()">↓ Export</button>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><span class="card-title">Cash Forecast 2026</span><span class="card-sub" id="forecastEntity"></span></div>
    <div class="tbl-wrap"><table class="forecast-table data-table" id="forecastTable"></table></div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.forecast-table td[contenteditable="true"] {
  cursor: text; outline: none;
  border-bottom: 1px dashed var(--border2); min-width: 80px;
}
.forecast-table td[contenteditable="true"]:focus { background: rgba(59,130,246,0.06); }
.forecast-table .fc-delta { font-size: 0.72rem; }
.forecast-table .fc-over { color: #b45309; background: rgba(245,158,11,0.08); }
.forecast-table tfoot td { font-weight: 700; background: var(--surface2); }
```

- [ ] **Step 3: Implement `renderForecast()` in app.js**

```js
renderForecast() {
  const entity = state.globalEntity;
  const key    = `forecast_${entity}_2026`;
  const stored = JSON.parse(localStorage.getItem(key) || '{}');
  const el     = document.getElementById('forecastEntity');
  if (el) el.textContent = entity === 'all' ? 'All Entities' : entity;

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ROWS   = ['Revenue','COGS','Gross Profit','Operating Expenses','Net Income'];
  const now    = new Date();
  const currMo = now.getMonth(); // 0-indexed

  const tbl = document.getElementById('forecastTable');
  if (!tbl) return;

  const getVal = (row, mo) => stored[`${row}_${mo}`] ?? '';

  let html = `<thead><tr><th>Category</th>${MONTHS.map(m=>`<th class="r">${m}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>`;

  ROWS.forEach(row => {
    const vals = MONTHS.map((_,mo) => {
      const v = parseFloat(getVal(row, mo)) || 0;
      const isPast = mo < currMo;
      // For completed months, fetch actual (placeholder: show 0 with amber if over budget by >10%)
      return { v, isPast };
    });
    const total = vals.reduce((s,{v})=>s+v,0);
    html += `<tr><td>${row}</td>${vals.map(({v, isPast},mo) =>
      `<td class="r fc-cell" data-row="${row}" data-mo="${mo}">
        <div contenteditable="true" class="fc-edit" onblur="app.saveForecastCell('${row}',${mo},this.textContent)">${v || ''}</div>
      </td>`
    ).join('')}<td class="r"><strong>${this.fmt(total)}</strong></td></tr>`;
  });

  html += `</tbody><tfoot><tr><td>Total</td>${MONTHS.map((_,mo) => {
    const colTotal = ROWS.reduce((s,row)=>s+(parseFloat(getVal(row,mo))||0),0);
    return `<td class="r">${this.fmt(colTotal)}</td>`;
  }).join('')}<td></td></tr></tfoot>`;

  tbl.innerHTML = html;
},

saveForecastCell(row, mo, rawVal) {
  const entity = state.globalEntity;
  const key    = `forecast_${entity}_2026`;
  const stored = JSON.parse(localStorage.getItem(key) || '{}');
  const val    = parseFloat(rawVal.replace(/[^0-9.\-]/g,'')) || 0;
  stored[`${row}_${mo}`] = val;
  localStorage.setItem(key, JSON.stringify(stored));
  // Refresh totals without full re-render
  this.renderForecast();
},

resetForecast() {
  if (!confirm('Reset all forecast data for this entity?')) return;
  localStorage.removeItem(`forecast_${state.globalEntity}_2026`);
  this.renderForecast();
},
```

- [ ] **Step 4: Call `renderForecast()` from `navigate()` for page `forecast`**

- [ ] **Step 5: Verify in browser — 12-month grid shows editable cells. Type a number in Revenue Jan — Total column updates, footer row updates. Navigate away and back — values persist.**

- [ ] **Step 6: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: Cash Forecast editable monthly 2026 table with localStorage persistence"
```

---

## Task 8: Invoices — AR Aging Grid + Columns

**Files:**
- Modify: `index.html` — add aging grid above invoice table; add Age + Aging Bucket columns to table header
- Modify: `app.js` — augment existing `renderInvoices()` to compute aging, populate grid, add Age/Bucket columns

- [ ] **Step 1: Add aging grid and extra table headers in index.html**

Find `#page-invoices`. Above the existing table, add:

```html
<div class="aging-grid" id="invAgingGrid" style="margin-bottom:12px"></div>
```

In the `<thead>` of the invoices table, add two columns before the last column:

```html
<th class="r">Age (days)</th>
<th>Aging Bucket</th>
```

- [ ] **Step 2: Integrate aging into the invoice render function — do NOT post-process DOM**

Find the existing invoice render function in `app.js` (search for `renderInvoices` or `invoiceBody` or the tbody ID used). It builds invoice rows as an HTML string or via `innerHTML`. Integrate the aging columns **directly into that row template**, not as a post-render DOM pass.

**Pattern to follow — integrate these two cells into the existing row template:**

```js
// Inside the invoice row render loop, add these two cells before the last cell:
const aging = this.agingBucket(inv.due_date || inv.due_date_col); // use actual field name from invoice object
const ageCell   = `<td class="r">${aging.days !== undefined && aging.days >= 0 ? aging.days : '—'}</td>`;
const bucketCell = `<td><span class="aging-chip ${aging.cls}">${aging.label}</span></td>`;
// Example row string (adjust to match actual row template):
// `<tr>...<td>${inv.vendor}</td>..${ageCell}${bucketCell}..actions..</tr>`
```

**After rendering all rows, call the aging grid render separately** (this IS safe to call after innerHTML, since it uses its own container `#invAgingGrid`):

```js
_renderInvoiceAgingGrid(invoices) {
  const BUCKET_LABELS = ['Current','1-30 Days','31-60 Days','61-90 Days','90+ Days'];
  const BUCKET_CLS    = ['current','low','medium','high','critical'];
  const totals = [0,0,0,0,0];
  const counts = [0,0,0,0,0];
  const clsToIdx = { current:0, low:1, medium:2, high:3, critical:4 };

  invoices.forEach(inv => {
    const aging = this.agingBucket(inv.due_date);
    const idx = clsToIdx[aging.cls] ?? 0;
    totals[idx] += (inv.amount || 0);
    counts[idx]++;
  });

  const grid = document.getElementById('invAgingGrid');
  if (grid) {
    grid.innerHTML = BUCKET_LABELS.map((label, i) => `
      <div class="aging-cell ${this._invBucketFilter===BUCKET_CLS[i]?'active':''}" onclick="app.filterInvoicesByBucket('${BUCKET_CLS[i]}')">
        <div class="aging-cell-label">${label}</div>
        <div class="aging-cell-val">${this.fmt(totals[i])}</div>
        <div class="aging-cell-count">${counts[i]} invoice${counts[i]!==1?'s':''}</div>
      </div>`).join('');
  }
},

filterInvoicesByBucket(bucket) {
  this._invBucketFilter = this._invBucketFilter === bucket ? null : bucket;
  this.navigate('invoices'); // re-fetches and re-renders with filter active
},
```

In `renderInvoices()`, apply the bucket filter before building the row HTML:

```js
// Apply bucket filter if active
const filtered = this._invBucketFilter
  ? invoices.filter(inv => this.agingBucket(inv.due_date).cls === this._invBucketFilter)
  : invoices;
// then render filtered rows and call this._renderInvoiceAgingGrid(invoices) (unfiltered totals)
```

- [ ] **Step 3: Verify in browser — Invoices page shows 5-cell aging grid above table. Age (days) and Aging Bucket columns appear in the table. Click a bucket cell — table filters to that age group.**

- [ ] **Step 4: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: Invoices AR aging grid + Age/Aging Bucket columns"
```

---

## Sprint 3 QA Checklist

- [ ] AP tab shows in sidebar for COO/CPA/Admin roles
- [ ] AP KPI row: 4 cards with correct totals from Supabase
- [ ] AP aging grid: 5 buckets, clicking one filters table
- [ ] AP Pay button: item disappears from list, success toast shown
- [ ] AP Dispute button: prompt appears, note saved to Supabase
- [ ] Reconciliation Auto-Match button: runs fuzzy match, writes to `reconciliation_matches`, summary cards update
- [ ] Recon pending rows show Confirm/Dispute buttons
- [ ] CFO Notes: 6 cards in 2-column grid, executive banner with correct entity/period
- [ ] CFO Notes: type in a card, navigate away, return — content persists
- [ ] CFO Notes: Print — only notes visible, nav hidden
- [ ] Sales: live revenue banner shows current month total
- [ ] Sales: 7-bar weekly chart renders
- [ ] Sales: monthly table shows Current / Prior Month / Budget / vs Budget columns
- [ ] Product Mix: Meta/Google/TikTok grouped bar chart renders
- [ ] Product Mix: channel mix donut with legend renders
- [ ] Cash Forecast: 12-column editable grid; numbers persist across navigations; Total column auto-sums
- [ ] Invoices: Age and Aging Bucket columns present; aging grid above table; clicking bucket filters
- [ ] Global filter changes re-render all Sprint 3 pages correctly
- [ ] Dark mode: all Sprint 3 pages render correctly; `.cfr-note-card` uses `var(--surface2)`
