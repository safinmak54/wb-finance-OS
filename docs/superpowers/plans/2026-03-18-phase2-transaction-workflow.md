# Phase 2 — Transaction Workflow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Inbox page (upload CSV, manual entry, classify with COA dropdown) and the Ledger page (view and edit classified transactions), replacing the current "Transactions" page.

**Architecture:** Rename the existing `transactions` page to `inbox` in both `index.html` and `app.js`. Add a new `ledger` page. All data reads/writes go to Supabase (`raw_transactions` for inbox, `transactions` for ledger). The existing modal system and CSV import infrastructure are reused and extended. Phase 1 must be complete before starting this phase.

**Tech Stack:** Vanilla JS, Supabase REST, existing XLSX library (already loaded in `index.html`).

**Prerequisite:** Phase 1 complete. `transactions`, `closed_periods` tables exist. `raw_transactions` has `classified` and `classified_at` columns.

---

### Task 1: Rename "Transactions" to "Inbox" in navigation and HTML

**Files:**
- Modify: `index.html` (sidebar nav item, page div id)
- Modify: `app.js` (navigate map, all `'transactions'` references)

- [ ] **Step 1: Update sidebar nav item in `index.html`**

Find the transactions nav item (around line 45):

```html
<!-- Before: -->
<a class="nav-item" onclick="app.navigate('transactions')" data-page="transactions">
  ...Transactions...

<!-- After: -->
<a class="nav-item" onclick="app.navigate('inbox')" data-page="inbox">
  ...Inbox...
```

Also rename the review badge id if present: `id="reviewBadge"` stays the same (badge logic unchanged).

- [ ] **Step 2: Add Ledger nav item below Inbox in `index.html`**

After the Inbox nav item, insert:

```html
<a class="nav-item" onclick="app.navigate('ledger')" data-page="ledger">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>
  </svg>
  Ledger
</a>
```

- [ ] **Step 3: Rename page div from `page-transactions` to `page-inbox` in `index.html`**

```html
<!-- Before: -->
<div id="page-transactions" class="page">

<!-- After: -->
<div id="page-inbox" class="page">
```

- [ ] **Step 4: Add empty `page-ledger` div in `index.html` after page-inbox**

```html
<div id="page-ledger" class="page">
  <div id="ledgerContent"></div>
</div>
```

- [ ] **Step 5: Update `app.js` navigate map and all `'transactions'` references**

In `navigate()`, rename key and add ledger:

```js
// In titles map:
inbox:  ['Inbox', `Unclassified transactions`],
ledger: ['Ledger', `Classified transactions · ${period}`],
// Remove: transactions: ['Transactions', ...]
```

In the `navigate()` render switch:

```js
if (page === 'inbox')  this.renderInbox();
if (page === 'ledger') this.renderLedger();
// Remove: if (page === 'transactions') this.renderTransactions();
```

In `setEntity()`, rename the `transactions` case to `inbox` and add `ledger`.

Search `app.js` for all remaining `'transactions'` string references and update to `'inbox'`. Use find-replace carefully — `DATA.transactions` (the array) is different from the page name `'transactions'`.

- [ ] **Step 6: Verify in browser**

Open app. Sidebar should show "Inbox" and "Ledger" items where "Transactions" was. Clicking Inbox should navigate to the (still-existing) transactions view. Clicking Ledger should show a blank page (no error).

- [ ] **Step 7: Commit**

```bash
git add index.html app.js
git commit -m "feat: rename Transactions → Inbox, add Ledger nav item"
```

---

### Task 2: Build the Inbox page — list unclassified raw_transactions

**Files:**
- Modify: `app.js` — replace `renderTransactions()` with `renderInbox()`

- [ ] **Step 1: Confirm `_entityById` and `_entityByCode` are populated**

These lookup maps are already populated in `loadDataFromSupabase()` (lines 145–150 in app.js) during the entities fetch:
```js
window._entityByCode[e.code] = e.id;
window._entityById[e.id] = e.code;
```
No change needed — just verify `loadDataFromSupabase()` runs on boot (confirmed in Phase 1 Task 4).

- [ ] **Step 2: Add `renderInbox()` method to the app object**

Add this method (replacing or after the existing `renderTransactions`):

```js
async renderInbox() {
  const el = document.getElementById('page-inbox');
  if (!el) return;

  // Load COA accounts for dropdown
  const { data: accounts } = await supabaseClient
    .from('accounts')
    .select('id, account_code, account_name, account_type')
    .eq('is_active', true)
    .order('account_code');

  // Load unclassified raw transactions
  const { data: rawTxns, error } = await supabaseClient
    .from('raw_transactions')
    .select('*')
    .eq('classified', false)
    .order('transaction_date', { ascending: false });

  if (error) { this.toast('Failed to load inbox'); console.error(error); return; }

  const txns = rawTxns || [];
  const acctOptions = (accounts || []).map(a =>
    `<option value="${a.id}" data-type="${a.account_type}">${a.account_code} — ${a.account_name}</option>`
  ).join('');

  el.innerHTML = `
    <div class="page-toolbar">
      <div class="toolbar-left">
        <button class="btn btn-primary" onclick="app.openModal('uploadCSV')">
          ↑ Upload CSV
        </button>
        <button class="btn btn-secondary" onclick="app.openModal('newRawTxn')">
          + Manual Entry
        </button>
      </div>
      <div class="toolbar-right">
        <span class="badge">${txns.length} to classify</span>
        <button class="btn btn-secondary" id="bulkClassifyBtn" style="display:none"
          onclick="app.bulkClassify()">Classify Selected</button>
      </div>
    </div>

    ${txns.length === 0 ? `
      <div style="padding:64px;text-align:center;color:var(--text3)">
        <p style="font-size:15px;margin-bottom:8px">Inbox is empty</p>
        <p style="font-size:13px">Upload a CSV or add a manual transaction to get started.</p>
      </div>
    ` : `
      <div class="table-wrap">
        <table class="data-table" id="inboxTable">
          <thead>
            <tr>
              <th><input type="checkbox" id="selectAll" onchange="app.toggleSelectAll(this)"></th>
              <th>Date</th>
              <th>Description</th>
              <th>Entity</th>
              <th>Amount</th>
              <th>Source</th>
              <th style="min-width:260px">Category (COA)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${txns.map(t => `
              <tr data-id="${t.id}">
                <td><input type="checkbox" class="row-check" onchange="app.onRowCheck()"></td>
                <td>${t.transaction_date || ''}</td>
                <td>${t.description || ''}</td>
                <td>
                  <select class="entity-sel" data-id="${t.id}" onchange="app.setRowEntity(this)">
                    ${['WB','LP','KP','BP','WBP','ONEOPS'].map(e =>
                      `<option value="${e}" ${(window._entityById[t.entity_id]||'') === e ? 'selected' : ''}>${e}</option>`
                    ).join('')}
                  </select>
                </td>
                <td class="${Number(t.amount) >= 0 ? 'pos' : 'neg'}" style="font-variant-numeric:tabular-nums">
                  ${Number(t.amount) < 0 ? `(${fmt(Math.abs(t.amount))})` : fmt(Number(t.amount))}
                </td>
                <td><span class="badge badge-source">${t.source || 'manual'}</span></td>
                <td>
                  <select class="acct-sel" data-id="${t.id}">
                    <option value="">— select account —</option>
                    ${acctOptions}
                  </select>
                </td>
                <td>
                  <button class="btn btn-sm btn-primary" onclick="app.classifyRow('${t.id}')">Classify</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
},
```

- [ ] **Step 2: Add helper methods for inbox interactions**

```js
toggleSelectAll(checkbox) {
  document.querySelectorAll('.row-check').forEach(c => c.checked = checkbox.checked);
  this.onRowCheck();
},

onRowCheck() {
  const anyChecked = [...document.querySelectorAll('.row-check')].some(c => c.checked);
  const btn = document.getElementById('bulkClassifyBtn');
  if (btn) btn.style.display = anyChecked ? 'inline-flex' : 'none';
},

setRowEntity(sel) {
  // Entity is set per-row in UI; stored in the classify call
},
```

- [ ] **Step 3: Verify in browser**

Navigate to Inbox. Expected:
- Empty state if no raw transactions in DB
- If you manually insert a test row in Supabase SQL Editor (`INSERT INTO raw_transactions (description, amount, transaction_date, accounting_date, source) VALUES ('Test', 100, CURRENT_DATE, CURRENT_DATE, 'manual');`), it should appear in the Inbox with a category dropdown.

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "feat: Inbox page lists unclassified raw_transactions with COA dropdown"
```

---

### Task 3: Classify a transaction (single row)

**Files:**
- Modify: `app.js` — add `classifyRow()`

- [ ] **Step 1: Add `classifyRow()` method**

```js
async classifyRow(rawId) {
  const row = document.querySelector(`tr[data-id="${rawId}"]`);
  if (!row) return;

  const accountId = row.querySelector('.acct-sel')?.value;
  const entityCode = row.querySelector('.entity-sel')?.value;

  if (!accountId) { this.toast('Select a category first'); return; }
  if (!entityCode) { this.toast('Select an entity'); return; }

  const rawTxn = await supabaseClient
    .from('raw_transactions')
    .select('*')
    .eq('id', rawId)
    .single();

  if (rawTxn.error) { this.toast('Could not load transaction'); return; }
  const t = rawTxn.data;

  // Check if acc_date period is closed
  const accPeriod = (t.accounting_date || '').slice(0, 7);
  const { data: closedCheck } = await supabaseClient
    .from('closed_periods')
    .select('id')
    .eq('period', accPeriod)
    .eq('entity', entityCode)
    .maybeSingle();
  if (closedCheck) { this.toast(`Period ${accPeriod} is closed — cannot classify`); return; }

  // Amount: DEBIT direction = expense (negative), CREDIT = income (positive)
  const amount = t.direction === 'DEBIT' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount));

  // Insert into transactions
  const { error: insErr } = await supabaseClient.from('transactions').insert({
    raw_transaction_id: rawId,
    entity: entityCode,
    account_id: accountId,
    amount: amount,
    txn_date: t.transaction_date,
    acc_date: t.accounting_date || t.transaction_date,
    description: t.description || '',
    memo: ''
  });

  if (insErr) {
    if (insErr.code === '23505') { this.toast('Already classified'); }
    else { this.toast('Error saving — see console'); console.error(insErr); }
    return;
  }

  // Mark raw as classified
  await supabaseClient.from('raw_transactions').update({
    classified: true,
    classified_at: new Date().toISOString()
  }).eq('id', rawId);

  this.toast('Classified ✓');
  row.remove();

  // Update inbox badge count
  const badge = document.querySelector('#page-inbox .badge');
  if (badge) {
    const current = parseInt(badge.textContent) || 0;
    badge.textContent = Math.max(0, current - 1) + ' to classify';
  }
},
```

- [ ] **Step 2: Verify in browser**

With a test raw transaction in the Inbox:
1. Select a COA category from the dropdown
2. Click Classify
3. Expected: row disappears from Inbox, toast "Classified ✓"
4. Check in Supabase SQL Editor: `SELECT * FROM transactions;` — should have 1 row. `SELECT classified FROM raw_transactions WHERE id = '<id>';` — should be `true`.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: classify single transaction — writes to transactions table"
```

---

### Task 4: Bulk classify

**Files:**
- Modify: `app.js` — add `bulkClassify()`

- [ ] **Step 1: Add `bulkClassify()` method**

```js
async bulkClassify() {
  const checkedRows = [...document.querySelectorAll('.row-check:checked')]
    .map(c => c.closest('tr'));

  if (!checkedRows.length) { this.toast('No rows selected'); return; }

  // All selected rows must have same account selected
  const accountIds = new Set(checkedRows.map(r => r.querySelector('.acct-sel')?.value).filter(Boolean));
  if (accountIds.size === 0) { this.toast('Select a category for all checked rows'); return; }
  if (accountIds.size > 1) { this.toast('All selected rows must use the same category for bulk classify'); return; }

  const accountId = [...accountIds][0];
  let success = 0, failed = 0;

  for (const row of checkedRows) {
    const rawId = row.dataset.id;
    const entityCode = row.querySelector('.entity-sel')?.value;
    if (!entityCode) { failed++; continue; }

    const rawTxn = await supabaseClient.from('raw_transactions').select('*').eq('id', rawId).single();
    if (rawTxn.error) { failed++; continue; }
    const t = rawTxn.data;

    const amount = t.direction === 'DEBIT' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount));

    const { error: insErr } = await supabaseClient.from('transactions').insert({
      raw_transaction_id: rawId,
      entity: entityCode,
      account_id: accountId,
      amount,
      txn_date: t.transaction_date,
      acc_date: t.accounting_date || t.transaction_date,
      description: t.description || '',
      memo: ''
    });

    if (insErr && insErr.code !== '23505') { failed++; continue; }

    await supabaseClient.from('raw_transactions').update({
      classified: true,
      classified_at: new Date().toISOString()
    }).eq('id', rawId);

    row.remove();
    success++;
  }

  this.toast(`${success} classified${failed ? `, ${failed} failed` : ''}`);
  document.getElementById('bulkClassifyBtn').style.display = 'none';
},
```

- [ ] **Step 2: Verify in browser**

Insert 3 test rows in Supabase. In Inbox, select all 3, pick same category, click "Classify Selected". Expected: all 3 rows removed, toast "3 classified".

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: bulk classify multiple inbox rows with same COA category"
```

---

### Task 5: CSV upload — file parsing and column mapping

**Files:**
- Modify: `app.js` — update `openModal('uploadCSV')` and add `handleCSVUpload()`
- Modify: `index.html` — update CSV upload modal HTML

The app already has a CSV import modal and XLSX library. Update it to land rows in `raw_transactions`.

- [ ] **Step 1: Update the CSV upload modal HTML in `index.html`**

Find the existing CSV modal (search for `uploadCSV` in `index.html`). Ensure it has:

```html
<div id="modal-uploadCSV" class="modal-pane" style="display:none">
  <h3>Upload Bank CSV</h3>
  <div id="csvUploadArea" style="border:2px dashed var(--border);border-radius:8px;padding:32px;text-align:center;cursor:pointer"
    onclick="document.getElementById('csvFileInput').click()"
    ondragover="event.preventDefault()" ondrop="app.handleCSVDrop(event)">
    <p>Click to select or drag & drop CSV / XLS / XLSX</p>
    <input type="file" id="csvFileInput" accept=".csv,.xls,.xlsx" style="display:none"
      onchange="app.handleCSVFile(this.files[0])">
  </div>
  <div id="csvMapping" style="display:none;margin-top:16px"></div>
  <div id="csvPreview" style="display:none;margin-top:16px"></div>
  <div id="csvActions" style="display:none;margin-top:16px">
    <button class="btn btn-primary" onclick="app.importCSV()">Import Transactions</button>
    <button class="btn btn-secondary" onclick="app.closeModal()">Cancel</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSV file handler to `app.js`**

```js
handleCSVDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) this.handleCSVFile(file);
},

handleCSVFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) { this.toast('File appears empty'); return; }

    const headers = (rows[0] || []).map(h => String(h).trim());
    this._csvRows = rows.slice(1).filter(r => r.some(c => c !== ''));
    this._csvHeaders = headers;

    // Auto-detect column mapping
    const normalize = s => s.toLowerCase().replace(/[^a-z]/g, '');
    const find = (...candidates) => {
      for (const c of candidates) {
        const idx = headers.findIndex(h => normalize(h).includes(normalize(c)));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    this._csvMap = {
      date:   find('transactiondate', 'date', 'posteddate', 'postingdate'),
      desc:   find('description', 'memo', 'payee', 'name', 'narrative'),
      amount: find('amount', 'net'),
      debit:  find('debit', 'withdrawal', 'charge'),
      credit: find('credit', 'deposit', 'payment'),
    };

    // Show mapping UI if date or desc not found, or if debit+credit split
    const needsMapping = this._csvMap.date < 0 || this._csvMap.desc < 0
      || (this._csvMap.amount < 0 && (this._csvMap.debit < 0 || this._csvMap.credit < 0));

    if (needsMapping) {
      this.showCSVMappingUI(headers);
    } else {
      this.showCSVPreview();
    }
  };
  reader.readAsArrayBuffer(file);
},

showCSVMappingUI(headers) {
  const mapDiv = document.getElementById('csvMapping');
  const opts = headers.map((h, i) => `<option value="${i}">${h}</option>`).join('');
  mapDiv.innerHTML = `
    <p style="font-weight:500;margin-bottom:8px">Map columns from your file:</p>
    ${['date','desc','amount'].map(field => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <label style="width:100px;text-transform:capitalize">${field}</label>
        <select id="csvMap_${field}" style="flex:1">
          <option value="-1">— not present —</option>
          ${opts}
        </select>
      </div>
    `).join('')}
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <label style="width:100px">Debit col</label>
      <select id="csvMap_debit" style="flex:1"><option value="-1">— not present —</option>${opts}</select>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <label style="width:100px">Credit col</label>
      <select id="csvMap_credit" style="flex:1"><option value="-1">— not present —</option>${opts}</select>
    </div>
    <button class="btn btn-secondary" onclick="app.applyCSVMapping()">Preview →</button>
  `;
  // Pre-select auto-detected values
  ['date','desc','amount','debit','credit'].forEach(f => {
    const sel = document.getElementById('csvMap_' + f);
    if (sel && this._csvMap[f] >= 0) sel.value = this._csvMap[f];
  });
  mapDiv.style.display = 'block';
},

applyCSVMapping() {
  ['date','desc','amount','debit','credit'].forEach(f => {
    const sel = document.getElementById('csvMap_' + f);
    if (sel) this._csvMap[f] = parseInt(sel.value);
  });
  document.getElementById('csvMapping').style.display = 'none';
  this.showCSVPreview();
},

showCSVPreview() {
  const preview = this.parseCSVRows();
  const previewDiv = document.getElementById('csvPreview');
  previewDiv.innerHTML = `
    <p style="font-weight:500">${preview.length} transactions found</p>
    <div style="max-height:200px;overflow:auto">
      <table class="data-table" style="font-size:12px">
        <thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
        <tbody>
          ${preview.slice(0,10).map(r => `
            <tr><td>${r.date}</td><td>${r.desc}</td><td>${r.amount}</td></tr>
          `).join('')}
          ${preview.length > 10 ? `<tr><td colspan="3" style="color:var(--text3)">...and ${preview.length - 10} more</td></tr>` : ''}
        </tbody>
      </table>
    </div>
  `;
  previewDiv.style.display = 'block';
  document.getElementById('csvActions').style.display = 'flex';
},

parseCSVRows() {
  const { date: di, desc: dsi, amount: ai, debit: dbi, credit: ci } = this._csvMap;
  return (this._csvRows || []).map(row => {
    const dateVal = di >= 0 ? row[di] : '';
    const descVal = dsi >= 0 ? row[dsi] : '';
    let amountVal = 0;
    if (ai >= 0) {
      amountVal = parseFloat(String(row[ai]).replace(/[$,\s]/g, '')) || 0;
    } else if (dbi >= 0 || ci >= 0) {
      const debit  = dbi >= 0 ? (parseFloat(String(row[dbi]).replace(/[$,\s]/g,''))||0) : 0;
      const credit = ci  >= 0 ? (parseFloat(String(row[ci]).replace(/[$,\s]/g,''))||0) : 0;
      amountVal = credit - debit; // positive = money in, negative = money out
    }
    const dateStr = dateVal instanceof Date
      ? dateVal.toISOString().split('T')[0]
      : String(dateVal).trim();
    return { date: dateStr, desc: String(descVal).trim(), amount: amountVal };
  }).filter(r => r.date && (r.desc || r.amount !== 0));
},

async importCSV() {
  const rows = this.parseCSVRows();
  if (!rows.length) { this.toast('No rows to import'); return; }

  const inserts = rows.map(r => ({
    description: r.desc,
    amount: Math.abs(r.amount),
    direction: r.amount >= 0 ? 'CREDIT' : 'DEBIT',
    transaction_date: r.date,
    accounting_date: r.date,
    source: 'csv',
    classified: false
  }));

  const { error } = await supabaseClient.from('raw_transactions').insert(inserts);
  if (error) { this.toast('Import failed — see console'); console.error(error); return; }

  this.toast(`${rows.length} transactions imported to Inbox`);
  this.closeModal();
  await this.renderInbox();
},
```

- [ ] **Step 3: Verify in browser**

1. Click "Upload CSV" in Inbox
2. Upload a simple CSV with columns `Date,Description,Amount`
3. Expected: preview shows parsed rows
4. Click Import — rows appear in Inbox

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "feat: CSV upload with auto column mapping lands rows in raw_transactions"
```

---

### Task 6: Manual transaction entry

**Files:**
- Modify: `app.js` — add `saveRawTxn()`
- Modify: `index.html` — add `modal-newRawTxn`

- [ ] **Step 1: Add manual entry modal to `index.html`**

```html
<div id="modal-newRawTxn" class="modal-pane" style="display:none">
  <h3>Add Transaction</h3>
  <label>Date <input type="date" id="fRawDate" value=""></label>
  <label>Description <input type="text" id="fRawDesc" placeholder="e.g. Google Ads charge"></label>
  <label>Amount
    <input type="number" id="fRawAmount" placeholder="e.g. 1200.00" step="0.01">
    <small>Negative = expense, Positive = income</small>
  </label>
  <label>Entity
    <select id="fRawEntity">
      <option value="WB">WB</option><option value="LP">LP</option>
      <option value="KP">KP</option><option value="BP">BP</option>
      <option value="WBP">WBP</option><option value="ONEOPS">ONEOPS</option>
    </select>
  </label>
  <label>Source
    <select id="fRawSource">
      <option value="manual">Manual</option><option value="bank">Bank</option>
      <option value="csv">CSV</option>
    </select>
  </label>
  <div class="modal-actions">
    <button class="btn btn-primary" onclick="app.saveRawTxn()">Add to Inbox</button>
    <button class="btn btn-ghost" onclick="app.closeModal()">Cancel</button>
  </div>
</div>
```

- [ ] **Step 2: Add `saveRawTxn()` to `app.js`**

```js
async saveRawTxn() {
  const date   = document.getElementById('fRawDate')?.value;
  const desc   = document.getElementById('fRawDesc')?.value?.trim();
  const amount = parseFloat(document.getElementById('fRawAmount')?.value);
  const entity = document.getElementById('fRawEntity')?.value;
  const source = document.getElementById('fRawSource')?.value || 'manual';

  if (!date || !desc || isNaN(amount)) {
    this.toast('Date, description, and amount are required');
    return;
  }

  const entityId = window._entityByCode[entity];

  const { error } = await supabaseClient.from('raw_transactions').insert({
    entity_id: entityId || null,
    description: desc,
    amount: Math.abs(amount),
    direction: amount >= 0 ? 'CREDIT' : 'DEBIT',
    transaction_date: date,
    accounting_date: date,
    source,
    classified: false
  });

  if (error) { this.toast('Failed to save — see console'); console.error(error); return; }

  this.toast('Added to Inbox');
  this.closeModal();
  await this.renderInbox();
},
```

- [ ] **Step 3: Verify in browser**

Click "+ Manual Entry" in Inbox, fill form, submit. Row should appear in Inbox immediately.

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "feat: manual transaction entry lands in Inbox"
```

---

### Task 7: + New Account (create COA on the fly from Inbox)

**Files:**
- Modify: `app.js` — add `saveAccountFromInbox()`
- Modify: `index.html` — add `modal-newAccountInbox`

- [ ] **Step 1: Add link in Inbox dropdown area**

In the `renderInbox()` table, after the account select dropdown add a link:

```html
<div style="font-size:11px;margin-top:2px">
  <a href="#" onclick="app.openModal('newAccountInbox');return false">+ New account</a>
</div>
```

- [ ] **Step 2: Add new account modal**

```html
<div id="modal-newAccountInbox" class="modal-pane" style="display:none">
  <h3>New COA Account</h3>
  <label>Account Code <input type="text" id="fNewAccCode" placeholder="e.g. 6650"></label>
  <label>Account Name <input type="text" id="fNewAccName" placeholder="e.g. Warehouse supplies"></label>
  <label>Type
    <select id="fNewAccType">
      <option value="revenue">Revenue</option>
      <option value="expense" selected>Expense</option>
      <option value="asset">Asset</option>
      <option value="liability">Liability</option>
      <option value="equity">Equity</option>
    </select>
  </label>
  <label>Subtype <input type="text" id="fNewAccSubtype" placeholder="e.g. opex, cogs, advertising"></label>
  <div class="modal-actions">
    <button class="btn btn-primary" onclick="app.saveAccountFromInbox()">Create Account</button>
    <button class="btn btn-ghost" onclick="app.closeModal()">Cancel</button>
  </div>
</div>
```

- [ ] **Step 3: Add `saveAccountFromInbox()` to `app.js`**

```js
async saveAccountFromInbox() {
  const code    = document.getElementById('fNewAccCode')?.value?.trim();
  const name    = document.getElementById('fNewAccName')?.value?.trim();
  const type    = document.getElementById('fNewAccType')?.value;
  const subtype = document.getElementById('fNewAccSubtype')?.value?.trim();

  if (!code || !name) { this.toast('Code and name are required'); return; }

  const { error } = await supabaseClient.from('accounts').insert({
    account_code: code,
    account_name: name,
    account_type: type,
    account_subtype: subtype || type,
    normal_balance: (type === 'asset' || type === 'expense') ? 'DEBIT' : 'CREDIT',
    is_active: true
  });

  if (error) {
    if (error.code === '23505') this.toast('Account code already exists');
    else { this.toast('Failed — see console'); console.error(error); }
    return;
  }

  this.toast(`Account ${code} created`);
  this.closeModal();
  await this.renderInbox(); // re-renders with new account in dropdown
},
```

- [ ] **Step 4: Verify in browser**

Click "+ New account" link in Inbox. Create an account. Close modal. The new account should appear in the COA dropdown immediately when Inbox re-renders.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: create new COA account on the fly from Inbox"
```

---

### Task 8: Build the Ledger page

**Files:**
- Modify: `app.js` — add `renderLedger()` and `editLedgerRow()`

- [ ] **Step 1: Add `renderLedger()` to `app.js`**

```js
async renderLedger() {
  const el = document.getElementById('ledgerContent');
  if (!el) return;

  // Build filters
  const entity = state.currentEntity;
  const period = state.currentPeriod;

  let query = supabaseClient
    .from('transactions')
    .select('*, accounts(account_code, account_name, account_type)')
    .order('acc_date', { ascending: false });

  if (entity !== 'all') query = query.eq('entity', entity);
  if (period) query = query.gte('acc_date', period + '-01').lte('acc_date', period + '-31');

  const { data: txns, error } = await query;
  if (error) { this.toast('Failed to load ledger'); console.error(error); return; }

  const rows = txns || [];

  el.innerHTML = rows.length === 0 ? `
    <div style="padding:64px;text-align:center;color:var(--text3)">
      <p style="font-size:15px;margin-bottom:8px">No classified transactions</p>
      <p style="font-size:13px">Classify transactions in the Inbox to see them here.</p>
    </div>
  ` : `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Acc. Date</th>
            <th>Description</th>
            <th>Entity</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Memo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(t => `
            <tr>
              <td>${t.acc_date || ''}</td>
              <td>${t.description || ''}</td>
              <td>${t.entity || ''}</td>
              <td>${t.accounts ? t.accounts.account_code + ' — ' + t.accounts.account_name : ''}</td>
              <td class="${Number(t.amount) >= 0 ? 'pos' : 'neg'}" style="font-variant-numeric:tabular-nums">
                ${Number(t.amount) < 0 ? `(${fmt(Math.abs(t.amount))})` : fmt(Number(t.amount))}
              </td>
              <td style="color:var(--text3);font-size:12px">${t.memo || ''}</td>
              <td>
                <button class="btn btn-sm btn-ghost" onclick="app.editLedgerRow('${t.id}')">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
},
```

- [ ] **Step 2: Confirm existing modal structure**

The app has an existing `#modal` overlay and `#modalBody` inner div (used throughout app.js for all modal forms — search `document.getElementById('modal')` and `document.getElementById('modalBody')` to confirm). The edit flow reuses this same pattern. No new modal HTML needed for the edit flow.

- [ ] **Step 3: Add `editLedgerRow()` and `saveLedgerEdit()` to `app.js`**

```js
async editLedgerRow(txnId) {
  const { data: t, error } = await supabaseClient
    .from('transactions')
    .select('*, accounts(id, account_code, account_name)')
    .eq('id', txnId)
    .single();
  if (error) { this.toast('Could not load transaction'); return; }

  const { data: accounts } = await supabaseClient
    .from('accounts').select('id, account_code, account_name').eq('is_active', true).order('account_code');

  const acctOptions = (accounts || []).map(a =>
    `<option value="${a.id}" ${a.id === t.account_id ? 'selected' : ''}>${a.account_code} — ${a.account_name}</option>`
  ).join('');

  this._editingLedgerTxn = t;

  // Reuse the existing modal system — open with a custom form
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.innerHTML = `
      <h3>Edit Transaction</h3>
      <label>Category (COA)
        <select id="fEditAcct">${acctOptions}</select>
      </label>
      <label>Accounting Date <input type="date" id="fEditAccDate" value="${t.acc_date || ''}"></label>
      <label>Memo <input type="text" id="fEditMemo" value="${t.memo || ''}"></label>
      <div class="modal-actions">
        <button class="btn btn-primary" onclick="app.saveLedgerEdit('${txnId}')">Save</button>
        <button class="btn btn-ghost" onclick="app.closeModal()">Cancel</button>
      </div>
    `;
  }
  document.getElementById('modal')?.classList.add('open');
},

async saveLedgerEdit(txnId) {
  const accountId = document.getElementById('fEditAcct')?.value;
  const accDate   = document.getElementById('fEditAccDate')?.value;
  const memo      = document.getElementById('fEditMemo')?.value?.trim();

  if (!accountId || !accDate) { this.toast('Category and date are required'); return; }

  const { error } = await supabaseClient.from('transactions').update({
    account_id: accountId,
    acc_date: accDate,
    memo: memo || null
  }).eq('id', txnId);

  if (error) { this.toast('Save failed — see console'); console.error(error); return; }

  this.toast('Updated ✓');
  this.closeModal();
  await this.renderLedger();
},
```

**Note on pagination and sort:** The spec lists pagination (15 rows/page) and sortable columns for the Ledger. These are deferred to a follow-up iteration — MVP delivers filter by entity/period and the edit capability. QA should validate classify/edit functionality, not sort/pagination.

- [ ] **Step 4: Wire up entity/period filter changes to re-render Ledger**

In `setEntity()` and `setPeriod()` in `app.js`, add:

```js
else if (pg === 'ledger') await this.renderLedger();
```

- [ ] **Step 4: Verify in browser**

After classifying some transactions in Inbox, navigate to Ledger. Expected:
- Classified transactions appear in table
- Clicking Edit opens modal with category/date/memo editable
- Saving updates the row in Ledger

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: Ledger page shows classified transactions with edit capability"
```

---

### Task 9: Update review badge to count unclassified inbox items

**Files:**
- Modify: `app.js` — `loadDataFromSupabase()` badge update

- [ ] **Step 1: Update the review badge to count unclassified raw_transactions**

In `loadDataFromSupabase()`, find the `reviewBadge` update (around line 182) and replace:

```js
// Before:
const reviewCount = DATA.transactions.filter(t => t.status === 'review').length;
const badge = document.getElementById('reviewBadge');
if (badge) badge.textContent = reviewCount || '';

// After:
const { count } = await supabaseClient
  .from('raw_transactions')
  .select('*', { count: 'exact', head: true })
  .eq('classified', false);
const badge = document.getElementById('reviewBadge');
if (badge) badge.textContent = count || '';
```

- [ ] **Step 2: Commit**

```bash
git add app.js
git commit -m "feat: inbox badge shows live count of unclassified transactions"
```

---

### Task 10: Push Phase 2 to QA

- [ ] **Step 1: Final browser check**

Checklist:
- [ ] Upload a CSV → rows appear in Inbox
- [ ] Add manual transaction → appears in Inbox
- [ ] Classify single row → disappears from Inbox, appears in Ledger
- [ ] Select multiple rows → bulk classify works
- [ ] Create new COA account → appears in dropdown
- [ ] Edit a classified transaction in Ledger → saves correctly
- [ ] Entity and period filters on Ledger work

- [ ] **Step 2: Push to qa**

```bash
git checkout qa
git merge main
git push origin qa
git checkout main
```
