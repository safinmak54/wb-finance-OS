# Phase 4 — Month-end Close Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the month-end close workflow — cash entries (fixed from bank), accrual entries (manual), and mandatory adjusting entries — accessible from the Journal Entries page.

**Architecture:** A "Close Month" button on the Journal Entries page opens a multi-step modal workflow. The system reads cash totals from `transactions` for the period, lets the user enter accrual amounts, calculates the difference as an adjusting entry, and requires explicit confirmation before posting. On confirm, rows are inserted into `journal_entries` and the period is locked in `closed_periods`. The P&L (built in Phase 3) automatically includes these adjusting entries.

**Tech Stack:** Vanilla JS, Supabase REST.

**Prerequisite:** Phase 3 complete. `closed_periods` table exists. `journal_entries` has `entry_type` and `period` columns.

---

### Task 1: Add "Close Month" button to Journal Entries page

**Files:**
- Modify: `app.js` — `renderJournals()`
- Modify: `index.html` — Journal Entries page toolbar (if exists)

- [ ] **Step 1: Find the Journal Entries render method in `app.js`**

Search for `renderJournals` (around line 622). It renders `DATA.journals`.

- [ ] **Step 2: Update `renderJournals()` to load from Supabase and add Close Month button**

Replace the existing `renderJournals()` with:

```js
async renderJournals() {
  const el = document.getElementById('page-journals');
  if (!el) return;

  const period = state.currentPeriod;

  // Check if period is already closed
  const { data: closedCheck } = await supabaseClient
    .from('closed_periods')
    .select('id, closed_at')
    .eq('period', period)
    .maybeSingle();

  const isClosed = !!closedCheck;

  // Load journal entries for this period
  const { data: journals, error } = await supabaseClient
    .from('journal_entries')
    .select('id, accounting_date, description, entry_type, period, entity_id, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name))')
    .eq('period', period)
    .order('accounting_date', { ascending: false });

  if (error) { console.error('Journal load error:', error); }
  const rows = journals || [];

  // Flatten ledger entries for display
  const displayRows = [];
  rows.forEach(je => {
    const shortId = 'JE-' + je.id.slice(0,8).toUpperCase();
    (je.ledger_entries || []).forEach(line => {
      displayRows.push({
        id: shortId,
        date: je.accounting_date,
        memo: line.memo || je.description,
        account: line.accounts ? line.accounts.account_code + ' — ' + line.accounts.account_name : '',
        debit: Number(line.debit_amount) || 0,
        credit: Number(line.credit_amount) || 0,
        type: je.entry_type || 'manual'
      });
    });
  });

  const periodLabel = this.getPeriodLabel(period);

  el.innerHTML = `
    <div class="page-toolbar">
      <div class="toolbar-left">
        <button class="btn btn-secondary" onclick="app.openModal('newJournal')">+ Journal Entry</button>
      </div>
      <div class="toolbar-right">
        ${isClosed
          ? `<span class="badge badge-closed">✓ ${periodLabel} Closed</span>`
          : `<button class="btn btn-primary" onclick="app.openCloseMonth()">Close Month: ${periodLabel}</button>`
        }
      </div>
    </div>

    ${displayRows.length === 0 ? `
      <div style="padding:64px;text-align:center;color:var(--text3)">
        <p style="font-size:15px;margin-bottom:8px">No journal entries for ${periodLabel}</p>
      </div>
    ` : `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th><th>Date</th><th>Memo</th><th>Account</th>
              <th>Debit</th><th>Credit</th><th>Type</th>
            </tr>
          </thead>
          <tbody>
            ${displayRows.map(r => `
              <tr>
                <td style="font-family:var(--mono);font-size:12px">${r.id}</td>
                <td>${r.date}</td>
                <td>${r.memo}</td>
                <td>${r.account}</td>
                <td>${r.debit > 0 ? fmt(r.debit) : ''}</td>
                <td>${r.credit > 0 ? fmt(r.credit) : ''}</td>
                <td><span class="badge">${r.type}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
},
```

- [ ] **Step 3: Verify in browser**

Navigate to Journal Entries. Expected:
- "Close Month: [current period]" button visible
- Empty state or journal rows for the period
- If period is already closed, shows "✓ Closed" badge instead

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: Journal Entries page loads from Supabase with Close Month button"
```

---

### Task 2: Build the Close Month modal — Step 1: Cash summary

**Files:**
- Modify: `app.js` — add `openCloseMonth()`
- Modify: `index.html` — add `modal-closeMonth`

- [ ] **Step 1: Add close month modal to `index.html`**

```html
<div id="modal-closeMonth" class="modal-pane modal-wide" style="display:none">
  <h3 id="closeMonthTitle">Close Month</h3>
  <div id="closeMonthBody"></div>
</div>
```

- [ ] **Step 2: Add `openCloseMonth()` to `app.js`**

```js
async openCloseMonth() {
  const period = state.currentPeriod;
  const periodLabel = this.getPeriodLabel(period);

  // Step 1: Compute cash totals from transactions
  const { data: txns, error } = await supabaseClient
    .from('transactions')
    .select('amount, accounts(account_type, account_subtype, account_name, account_code)')
    .gte('acc_date', period + '-01')
    .lte('acc_date', period + '-31');

  if (error) { this.toast('Failed to load period data'); return; }

  const rows = txns || [];
  const sum = (fn) => rows.filter(fn).reduce((s, t) => s + Number(t.amount), 0);

  const cashRevenue = sum(t => t.accounts?.account_type === 'revenue');
  const cashCogs    = Math.abs(sum(t => t.accounts?.account_subtype === 'cogs'));
  const cashExpenses = Math.abs(sum(t => t.accounts?.account_type === 'expense'));

  this._closeMonthData = { period, periodLabel, cashRevenue, cashCogs, cashExpenses };

  document.getElementById('closeMonthTitle').textContent = `Close Month: ${periodLabel}`;
  document.getElementById('closeMonthBody').innerHTML = `
    <div class="close-step" id="closeStep1">
      <h4>Step 1 of 3 — Cash Basis Summary (from bank)</h4>
      <p style="color:var(--text3);font-size:13px;margin-bottom:16px">
        These amounts come directly from your classified transactions and are fixed.
      </p>
      <table class="data-table" style="margin-bottom:16px">
        <tr><td>Cash Revenue received</td><td style="text-align:right">${fmt(cashRevenue)}</td></tr>
        <tr><td>Cash COGS paid</td><td style="text-align:right">(${fmt(cashCogs)})</td></tr>
        <tr><td>Cash Expenses paid</td><td style="text-align:right">(${fmt(cashExpenses)})</td></tr>
        <tr style="font-weight:600">
          <td>Cash Net Income</td>
          <td style="text-align:right">${fmt(cashRevenue - cashCogs - cashExpenses)}</td>
        </tr>
      </table>
      <button class="btn btn-primary" onclick="app.closeMonthStep2()">Next: Accrual Entry →</button>
      <button class="btn btn-ghost" onclick="app.closeModal()" style="margin-left:8px">Cancel</button>
    </div>
  `;

  this.openModal('closeMonth');
},
```

- [ ] **Step 3: Verify in browser**

Click "Close Month" on Journal Entries page. Expected: modal shows cash summary matching classified transactions for the period. Amounts are read-only.

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "feat: Close Month modal step 1 shows cash basis summary"
```

---

### Task 3: Close Month Step 2 — Accrual entry input

**Files:**
- Modify: `app.js` — add `closeMonthStep2()`

- [ ] **Step 1: Add `closeMonthStep2()` to `app.js`**

```js
async closeMonthStep2() {
  const { period, periodLabel, cashRevenue, cashCogs, cashExpenses } = this._closeMonthData;

  // Load any existing accrual entries for this period (pre-populate if they exist)
  const { data: accrualJEs } = await supabaseClient
    .from('journal_entries')
    .select('ledger_entries(debit_amount, credit_amount, accounts(account_type, account_subtype))')
    .eq('period', period)
    .eq('entry_type', 'accrual');

  let existingAccrualRevenue = 0, existingAccrualCogs = 0;
  (accrualJEs || []).forEach(je => {
    (je.ledger_entries || []).forEach(l => {
      const net = Number(l.credit_amount || 0) - Number(l.debit_amount || 0);
      if (l.accounts?.account_type === 'revenue') existingAccrualRevenue += net;
      if (l.accounts?.account_subtype === 'cogs') existingAccrualCogs += Math.abs(net);
    });
  });

  // Use existing accrual if present, otherwise default to cash amounts
  const prefillRevenue = existingAccrualRevenue > 0 ? existingAccrualRevenue : cashRevenue;
  const prefillCogs    = existingAccrualCogs > 0 ? existingAccrualCogs : cashCogs;

  document.getElementById('closeMonthBody').innerHTML = `
    <div class="close-step" id="closeStep2">
      <h4>Step 2 of 3 — Accrual Amounts</h4>
      <p style="color:var(--text3);font-size:13px;margin-bottom:16px">
        Enter the accrual basis amounts for this period (what was earned/owed, not just what was paid).
        ${existingAccrualRevenue > 0 ? '<strong>Pre-filled from existing accrual journal entries.</strong>' : ''}
      </p>
      <div style="display:grid;gap:12px;margin-bottom:16px">
        <label>Accrual Revenue (earned this period)
          <input type="number" id="fAccrualRevenue" value="${prefillRevenue.toFixed(2)}" step="0.01"
            style="display:block;width:100%;margin-top:4px">
          <small style="color:var(--text3)">Cash received: ${fmt(cashRevenue)}</small>
        </label>
        <label>Accrual COGS (cost of goods for period)
          <input type="number" id="fAccrualCogs" value="${prefillCogs.toFixed(2)}" step="0.01"
            style="display:block;width:100%;margin-top:4px">
          <small style="color:var(--text3)">Cash paid: ${fmt(cashCogs)}</small>
        </label>
        <label>Memo / notes
          <input type="text" id="fAccrualMemo" placeholder="e.g. Accrual for March 2026 close"
            style="display:block;width:100%;margin-top:4px">
        </label>
      </div>
      <button class="btn btn-primary" onclick="app.closeMonthStep3()">Next: Review Adjustments →</button>
      <button class="btn btn-ghost" onclick="app.closeMonthStep1Back()" style="margin-left:8px">← Back</button>
    </div>
  `;
},

closeMonthStep1Back() {
  // Re-run step 1 without reopening modal
  this.openCloseMonth();
},
```

- [ ] **Step 2: Verify in browser**

Click Next from Step 1. Expected: form with Revenue and COGS pre-filled with cash amounts (user can change them). Memo field is blank.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: Close Month step 2 — accrual amount input"
```

---

### Task 4: Close Month Step 3 — Adjusting entry review and mandatory confirmation

**Files:**
- Modify: `app.js` — add `closeMonthStep3()` and `confirmMonthClose()`

- [ ] **Step 1: Add `closeMonthStep3()` to `app.js`**

```js
closeMonthStep3() {
  const accrualRevenue = parseFloat(document.getElementById('fAccrualRevenue')?.value) || 0;
  const accrualCogs    = parseFloat(document.getElementById('fAccrualCogs')?.value)    || 0;
  const memo           = document.getElementById('fAccrualMemo')?.value?.trim() || '';

  const { cashRevenue, cashCogs, cashExpenses, periodLabel } = this._closeMonthData;

  const revenueAdj = accrualRevenue - cashRevenue;  // positive = more earned than received
  const cogsAdj    = accrualCogs - cashCogs;         // positive = more owed than paid
  const netAdj     = revenueAdj - cogsAdj;

  // Save for confirm step
  this._adjustingEntry = { accrualRevenue, accrualCogs, revenueAdj, cogsAdj, netAdj, memo };

  const adjRow = (label, val) => `
    <tr>
      <td>${label}</td>
      <td style="text-align:right;color:${val >= 0 ? 'var(--green)' : 'var(--red)'}">
        ${val >= 0 ? fmt(val) : '(' + fmt(Math.abs(val)) + ')'}
      </td>
    </tr>
  `;

  document.getElementById('closeMonthBody').innerHTML = `
    <div class="close-step" id="closeStep3">
      <h4>Step 3 of 3 — Confirm Adjusting Entry</h4>
      <p style="color:var(--text3);font-size:13px;margin-bottom:16px">
        The following adjusting entry will be posted to Journal Entries. This step is required.
      </p>

      <table class="data-table" style="margin-bottom:8px">
        <thead><tr><th>Line</th><th style="text-align:right">Adjustment</th></tr></thead>
        <tbody>
          ${adjRow('Revenue adjustment (accrual − cash)', revenueAdj)}
          ${adjRow('COGS adjustment (accrual − cash)', -cogsAdj)}
          ${adjRow('Net adjusting entry', netAdj)}
        </tbody>
      </table>

      ${memo ? `<p style="color:var(--text3);font-size:13px;margin-bottom:16px">Memo: ${memo}</p>` : ''}

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px">
        <p style="font-size:13px;font-weight:500;margin-bottom:4px">Summary</p>
        <table style="width:100%;font-size:13px">
          <tr><td>Cash net income</td><td style="text-align:right">${fmt(cashRevenue - cashCogs - cashExpenses)}</td></tr>
          <tr><td>Adjusting entry</td><td style="text-align:right">${netAdj >= 0 ? fmt(netAdj) : '(' + fmt(Math.abs(netAdj)) + ')'}</td></tr>
          <tr style="font-weight:600;border-top:1px solid var(--border)">
            <td>Accrual net income</td>
            <td style="text-align:right">${fmt(cashRevenue - cashCogs - cashExpenses + netAdj)}</td>
          </tr>
        </table>
      </div>

      <p style="font-size:13px;color:var(--red);margin-bottom:12px">
        ⚠ This will lock ${periodLabel}. No new transactions can be classified into this period after close.
      </p>

      <button class="btn btn-primary" onclick="app.confirmMonthClose()">Confirm & Close Month</button>
      <button class="btn btn-ghost" onclick="app.closeMonthStep2()" style="margin-left:8px">← Back</button>
    </div>
  `;
},
```

- [ ] **Step 2: Add `confirmMonthClose()` to `app.js`**

```js
async confirmMonthClose() {
  const { period, periodLabel } = this._closeMonthData;
  const { revenueAdj, cogsAdj, netAdj, memo } = this._adjustingEntry;

  // Find a revenue account (account_type = 'revenue') and a COGS account (account_subtype = 'cogs')
  // Note: revenue uses account_type NOT account_subtype — they are different fields
  const [{ data: revAccts }, { data: cogsAccts }] = await Promise.all([
    supabaseClient.from('accounts').select('id, account_type').eq('account_type', 'revenue').limit(1),
    supabaseClient.from('accounts').select('id, account_subtype').eq('account_subtype', 'cogs').limit(1)
  ]);

  const revenueAcct = (revAccts || [])[0];
  const cogsAcct    = (cogsAccts || [])[0];

  const entityId = state.currentEntity !== 'all'
    ? window._entityByCode[state.currentEntity]
    : null;

  // Guard: if no adjustments needed, just lock the period (no journal entry created)
  if (Math.abs(revenueAdj) < 0.01 && Math.abs(cogsAdj) < 0.01) {
    await supabaseClient.from('closed_periods').insert({ period, entity: state.currentEntity, closed_by: 'user' });
    this.toast(`${periodLabel} closed (no adjustments needed) ✓`);
    this.closeModal();
    await this.renderJournals();
    return;
  }

  if (!revenueAcct || !cogsAcct) {
    this.toast('Could not find revenue or COGS accounts — check Chart of Accounts');
    return;
  }

  // Last day of the period (handles months with < 31 days)
  const [yr, mo] = period.split('-').map(Number);
  const lastDay = new Date(yr, mo, 0).getDate(); // day 0 of next month = last day of this month
  const closingDate = `${period}-${String(lastDay).padStart(2, '0')}`;

  const { data: je, error: jeErr } = await supabaseClient
    .from('journal_entries')
    .insert({
      description: memo || `Adjusting entry — ${periodLabel}`,
      accounting_date: closingDate,
      entry_type: 'adjusting',
      period: period,
      entity_id: entityId
    })
    .select('id')
    .single();

  if (jeErr) { this.toast('Failed to post journal entry'); console.error(jeErr); return; }

  // Build ledger lines (revenue adjustment + COGS adjustment)
  const lines = [];
  if (Math.abs(revenueAdj) > 0.01) {
    lines.push({
      journal_entry_id: je.id,
      account_id: revenueAcct.id,
      debit_amount:  revenueAdj < 0 ? Math.abs(revenueAdj) : 0,
      credit_amount: revenueAdj > 0 ? revenueAdj : 0,
      memo: `Revenue adjustment`
    });
  }
  if (Math.abs(cogsAdj) > 0.01) {
    lines.push({
      journal_entry_id: je.id,
      account_id: cogsAcct.id,
      debit_amount:  cogsAdj > 0 ? cogsAdj : 0,
      credit_amount: cogsAdj < 0 ? Math.abs(cogsAdj) : 0,
      memo: `COGS adjustment`
    });
  }

  if (lines.length > 0) {
    const { error: lineErr } = await supabaseClient.from('ledger_entries').insert(lines);
    if (lineErr) { this.toast('Failed to post ledger lines'); console.error(lineErr); return; }
  }

  // Lock the period
  const { error: lockErr } = await supabaseClient.from('closed_periods').insert({
    period,
    entity: state.currentEntity,
    closed_by: 'user'
  });

  if (lockErr && lockErr.code !== '23505') {
    this.toast('Failed to lock period'); console.error(lockErr); return;
  }

  this.toast(`${periodLabel} closed ✓`);
  this.closeModal();
  await this.renderJournals();
},
```

- [ ] **Step 3: Verify in browser**

Full close month flow:
1. Open Journal Entries for a period with classified transactions
2. Click "Close Month"
3. Step 1: verify cash summary is correct
4. Step 2: modify accrual revenue to be different from cash (e.g. add $5,000)
5. Step 3: verify adjusting entry shows `$5,000` revenue adjustment
6. Click "Confirm & Close Month"
7. Expected: Journal Entries page now shows "✓ Closed" badge; new adjusting journal entry appears in table
8. Navigate to P&L — "Adjusting Entries" section shows the posted entry
9. Try to classify a new transaction with the same `acc_date` period — should be rejected with "Period is closed"

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "feat: Close Month step 3 — confirm and post adjusting entry, lock period"
```

---

### Task 5: P&L dual-view for closed periods

**Files:**
- Modify: `app.js` — update `renderPnL()`

For closed months, show both cash basis and accrual basis totals.

- [ ] **Step 1: Add closed-period indicator to P&L**

In `renderPnL()` (Phase 3), after computing `noi` and `netProfit`, add a check:

```js
// After fetching report data, check if period is closed:
const { data: closedCheck } = await supabaseClient
  .from('closed_periods')
  .select('closed_at')
  .eq('period', period)
  .maybeSingle();

const isClosed = !!closedCheck;
const cashNetIncome = noi; // before adjusting entries
```

Then in the HTML output, after the Net Profit line, add (for closed periods only):

```js
${isClosed ? `
  <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:8px">
    <p style="font-size:12px;font-weight:500;color:var(--text3);margin-bottom:8px">PERIOD COMPARISON</p>
    <table style="width:100%;font-size:13px">
      <tr><td>Cash basis net income</td><td style="text-align:right">${fmt(cashNetIncome)}</td></tr>
      <tr><td>Adjusting entries</td><td style="text-align:right">${fmt(totalAdj)}</td></tr>
      <tr style="font-weight:600">
        <td>Accrual basis net income</td>
        <td style="text-align:right">${fmt(netProfit)}</td>
      </tr>
      <tr style="color:var(--text3)">
        <td>Delta</td>
        <td style="text-align:right">${fmt(Math.abs(totalAdj))}</td>
      </tr>
    </table>
  </div>
` : ''}
```

- [ ] **Step 2: Verify in browser**

After closing a month with an adjusting entry:
1. Navigate to P&L for that period
2. Expected: cash basis / accrual basis comparison table appears at bottom of P&L

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: P&L shows cash vs accrual comparison for closed periods"
```

---

### Task 6: Push Phase 4 to QA

- [ ] **Step 1: Final browser check**

Checklist:
- [ ] Journal Entries loads from Supabase for current period
- [ ] "Close Month" button is visible for open periods
- [ ] Step 1 shows correct cash summary
- [ ] Step 2 allows editing accrual amounts
- [ ] Step 3 shows adjusting entry breakdown
- [ ] Confirm closes month: journal entry appears, "✓ Closed" badge shown
- [ ] Classifying into a closed period is rejected
- [ ] P&L for closed month shows cash vs accrual comparison table
- [ ] P&L for open month shows no comparison table

- [ ] **Step 2: Push to qa for review**

```bash
git checkout qa
git merge main
git push origin qa
git checkout main
```
