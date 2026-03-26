# Sprint 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin role, global sticky filter bar with period/entity controls, topbar KPI pills, and a standalone import modal — establishing the shared infrastructure that all Sprint 2 and 3 features depend on.

**Architecture:** State migration first (rename `currentPeriod` → `globalPeriodRange`, `currentEntity` → `globalEntity`) so all existing fetch code works with the new filter bar. Then add HTML/CSS/JS for each UI feature in isolation. No page-specific logic changes in this sprint.

**Tech Stack:** Vanilla JS, CSS custom properties, Supabase REST API, SheetJS (already loaded)

---

## File Map

| File | What changes |
|---|---|
| `app.js` | ROLES admin entry; state key rename; `resolveGlobalPeriod()`; `onGlobalFilterChange()`; `updateTopbarKPIs()`; update `navigate()` filter bar visibility; update `fetchReportData()` and ~25 call sites; update `getPeriodLabel()`; import modal JS |
| `index.html` | Admin login tile; `#globalFilterBar` div; topbar KPI pill spans; import nav item + `<dialog id="importModal">` |
| `styles.css` | Filter bar, period buttons, entity chips, topbar pills, import modal styles |

---

## Task 1: Add Admin Role

**Files:**
- Modify: `app.js` lines ~20–25 (ROLES constant)
- Modify: `index.html` lines ~25–26 (login-roles div)

- [ ] **Step 1: Add admin entry to ROLES constant in app.js**

Find the `ROLES` block (currently 3 entries: coo, bookkeeper, cpa). Add a 4th:

```js
const ROLES = {
  coo:        { pass: 'wb-coo-2026',   label: 'COO View'        },
  bookkeeper: { pass: 'wb-books-2026', label: 'Bookkeeper View' },
  cpa:        { pass: 'wb-cpa-2026',   label: 'CPA View'        },
  admin:      { pass: 'wb-admin-2026', label: 'Admin'           },
};
```

- [ ] **Step 2: Add admin pages list**

Immediately after the ROLES block, add a lookup map of which pages each role can see. This replaces the role-based `data-roles` filtering. The admin sees everything:

```js
const ROLE_PAGES = {
  coo:        ['dashboard','pnl','balance','cashflow','ratios','cfnotes','ap','reconcile','sales','productmix','forecast','banks'],
  bookkeeper: ['inbox','ledger','journals','reconcile','vendors','invoices','coa'],
  cpa:        ['journals','pnl','balance','cashflow','ratios','cfnotes','invoices','coa'],
  admin:      ['dashboard','inbox','ledger','journals','pnl','balance','cashflow','ratios','cfnotes','ap','reconcile','sales','productmix','forecast','invoices','vendors','coa','banks'],
};
```

> Note: Cross-reference with the actual `data-roles` attributes in `index.html` sidebar to confirm the coo/bookkeeper/cpa page lists match what's already there. The admin list is the union of all.

- [ ] **Step 3: Add admin login tile in index.html**

Find the `<div class="login-roles">` section (currently has 3 `<span>` elements: COO, Bookkeeper, CPA). Add a 4th:

```html
<div class="login-roles">
  <span>COO</span><span>Bookkeeper</span><span>CPA</span><span style="color:#7C3AED;font-weight:700">Admin</span>
</div>
```

- [ ] **Step 4: Ensure admin login works**

In `app.js`, find the `login()` method. Confirm it loops through `Object.entries(ROLES)` and compares password. Because we added `admin` to `ROLES`, it should already work. Verify the logic — if it hardcodes role keys, add `admin` handling.

- [ ] **Step 5: Add `admin` to every sidebar `data-roles` attribute in index.html**

Every sidebar `<a>` or `<li>` with a `data-roles` attribute needs `admin` appended. Go through all 17 nav items. Example:

```html
<!-- Before -->
<a data-page="dashboard" data-roles="coo">

<!-- After -->
<a data-page="dashboard" data-roles="coo admin">
```

Do this for all nav items. The admin role should see every page.

- [ ] **Step 6: Open index.html in browser, enter `wb-admin-2026`, verify all 17 sidebar items are visible**

- [ ] **Step 7: Commit**

```bash
git add app.js index.html
git commit -m "feat: add admin role (wb-admin-2026) with full page access"
```

---

## Task 2: Migrate State Keys

**Files:**
- Modify: `app.js` — state object, `resolveGlobalPeriod()`, `fetchReportData()`, all `currentPeriod`/`currentEntity` references

This is a rename across ~40 call sites. Do it methodically: migrate state first, then add `resolveGlobalPeriod()`, then update all consumers.

- [ ] **Step 1: Update the state object initialization (app.js ~line 211)**

Replace:
```js
const state = {
  currentPage: 'dashboard',
  currentEntity: 'all',
  currentPeriod: new Date().toISOString().slice(0, 7),
  ...
};
```

With:
```js
const state = {
  currentPage: 'dashboard',
  globalEntity: 'all',
  globalPeriod: 'month',
  globalPeriodRange: (() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const to = now.toISOString().slice(0,10);
    return { from, to };
  })(),
  txnPage: 1,
  txnPageSize: 15,
  txnSort: { field: 'accDate', dir: 'desc' },
  filteredTxns: [...DATA.transactions],
  charts: {},
  pnlEntities: [],
};
```

- [ ] **Step 2: Add `resolveGlobalPeriod(semantic)` to app.js (near the top of the app object)**

```js
resolveGlobalPeriod(semantic, customFrom, customTo) {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const today = ymd(now);

  if (semantic === 'month') {
    const from = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
    return { from, to: today };
  }
  if (semantic === 'last-month') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: ymd(d), to: ymd(last) };
  }
  if (semantic === 'qtd') {
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1);
    return { from: ymd(qStart), to: today };
  }
  if (semantic === 'ytd') {
    return { from: `${now.getFullYear()}-01-01`, to: today };
  }
  if (semantic === 'custom') {
    return { from: customFrom || today, to: customTo || today };
  }
  // fallback: current month
  return { from: `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`, to: today };
},
```

- [ ] **Step 3: Update `getPeriodLabel()` to accept semantic strings**

Current implementation only handles `YYYY-MM`. Replace with:

```js
getPeriodLabel(val) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  if (!val) return 'Current Period';
  if (val === 'month') {
    const now = new Date();
    return `${months[now.getMonth()]} ${now.getFullYear()}`;
  }
  if (val === 'last-month') {
    const d = new Date(); d.setMonth(d.getMonth()-1);
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  }
  if (val === 'qtd') return `Q${Math.ceil((new Date().getMonth()+1)/3)} ${new Date().getFullYear()} to date`;
  if (val === 'ytd') return `YTD ${new Date().getFullYear()}`;
  if (val === 'custom') return 'Custom Range';
  // Legacy YYYY-MM format support (remove after full migration)
  if (/^\d{4}-\d{2}$/.test(val)) {
    const [year, month] = val.split('-');
    return `${months[parseInt(month,10)-1]} ${year}`;
  }
  return val;
},
```

- [ ] **Step 4: Update `fetchReportData(entity, period)` to use date range**

Current signature uses `period` (YYYY-MM) to build `period + '-01'` / `period + '-31'`. The new call sites will pass `state.globalPeriodRange`. Update:

```js
async fetchReportData(entity, periodRange) {
  // periodRange = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
  const range = periodRange || state.globalPeriodRange;
  let txnQuery = supabaseClient
    .from('transactions')
    .select('amount, account_id, accounts(id, account_code, account_name, account_type, account_subtype, line, is_elimination)')
    .gte('acc_date', range.from)
    .lte('acc_date', range.to);
  // ... rest of function unchanged
```

- [ ] **Step 5: Find all `state.currentPeriod` references and migrate**

Run a search in app.js for `state.currentPeriod`. For each occurrence, apply the correct migration from the spec:

- **Supabase date-range filter** → use `state.globalPeriodRange.from` / `.to`
- **Display label** → `this.getPeriodLabel(state.globalPeriod)`
- **CSV filename suffix** → `state.globalPeriodRange.from.slice(0,7)`
- **Supabase period-column equality** (`.eq('period', ...)`) → `.gte('period', state.globalPeriodRange.from.slice(0,7)).lte('period', state.globalPeriodRange.to.slice(0,7))`

- [ ] **Step 6: Find all `state.currentEntity` references and rename to `state.globalEntity`**

Simple rename — no behavior change. Use find-replace in app.js.

- [ ] **Step 7: Update `navigate()` to use new state keys**

In `navigate()`, the line:
```js
const period = this.getPeriodLabel(state.currentPeriod);
```
Changes to:
```js
const period = this.getPeriodLabel(state.globalPeriod);
```

Also update `state.currentPage = page` — this key name stays the same (not migrated).

- [ ] **Step 8: Verify in browser — login as COO, navigate to P&L, confirm data loads and period label shows correctly**

- [ ] **Step 9: Commit**

```bash
git add app.js
git commit -m "refactor: migrate state.currentPeriod → globalPeriodRange, currentEntity → globalEntity"
```

---

## Task 3: Global Sticky Filter Bar

**Files:**
- Modify: `index.html` — add `#globalFilterBar` between topbar and `<main class="main-content">`
- Modify: `styles.css` — add filter bar styles
- Modify: `app.js` — add `onGlobalFilterChange()`, update `navigate()` to show/hide bar, init filter bar on login

- [ ] **Step 1: Add HTML to index.html**

Locate `<main class="main-content">` in index.html. Insert `#globalFilterBar` immediately before it:

```html
<!-- GLOBAL FILTER BAR -->
<div id="globalFilterBar" style="display:none">
  <div class="gfb-periods">
    <button class="gfb-btn active" data-period="month" onclick="app.setGlobalPeriod('month')">This Month</button>
    <button class="gfb-btn" data-period="last-month" onclick="app.setGlobalPeriod('last-month')">Last Month</button>
    <button class="gfb-btn" data-period="qtd" onclick="app.setGlobalPeriod('qtd')">QTD</button>
    <button class="gfb-btn" data-period="ytd" onclick="app.setGlobalPeriod('ytd')">YTD</button>
    <button class="gfb-btn" data-period="custom" onclick="app.setGlobalPeriod('custom')">Custom ▾</button>
  </div>
  <div id="gfbCustomPopover" class="gfb-custom-popover" style="display:none">
    <label>From <input type="date" id="gfbFromDate"></label>
    <label>To <input type="date" id="gfbToDate"></label>
    <button class="gfb-btn active" onclick="app.applyCustomRange()">Apply</button>
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
    <option value="SP1">SP1</option>
  </select>
  <div id="gfbChips" class="gfb-chips"></div>
</div>
```

- [ ] **Step 2: Add CSS to styles.css**

```css
/* ---- GLOBAL FILTER BAR ---- */
#globalFilterBar {
  position: sticky;
  top: 56px;
  z-index: 90;
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  flex-wrap: wrap;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.gfb-periods { display: flex; gap: 4px; }
.gfb-btn {
  font-size: 0.75rem; padding: 4px 10px; border-radius: 6px;
  border: 1px solid var(--border); background: transparent;
  color: var(--text2); cursor: pointer; font-family: var(--sans);
  transition: background 0.12s, color 0.12s;
}
.gfb-btn:hover { background: var(--border2); }
.gfb-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
#gfbEntitySel {
  font-size: 0.75rem; padding: 4px 8px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text2); cursor: pointer;
}
.gfb-chips { display: flex; gap: 6px; margin-left: auto; align-items: center; }
.gfb-chip {
  font-size: 0.68rem; padding: 2px 8px; border-radius: 10px;
  background: var(--border2); color: var(--text2); cursor: pointer;
}
.gfb-chip:hover { background: var(--accent); color: #fff; }
.gfb-custom-popover {
  position: absolute; top: 52px; left: 20px; z-index: 200;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 16px;
  display: flex; gap: 12px; align-items: flex-end;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}
.gfb-custom-popover label { font-size: 0.72rem; color: var(--text2); display: flex; flex-direction: column; gap: 4px; }
.gfb-custom-popover input[type="date"] {
  font-size: 0.75rem; padding: 4px 8px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
}
```

- [ ] **Step 3: Add JS methods to app object**

Add these methods to the app object in app.js:

```js
setGlobalPeriod(semantic) {
  // Toggle active button
  document.querySelectorAll('.gfb-btn[data-period]').forEach(b => {
    b.classList.toggle('active', b.dataset.period === semantic);
  });
  if (semantic === 'custom') {
    const pop = document.getElementById('gfbCustomPopover');
    if (pop) pop.style.display = pop.style.display === 'none' ? 'flex' : 'none';
    return; // don't fire change yet — wait for applyCustomRange()
  }
  document.getElementById('gfbCustomPopover').style.display = 'none';
  state.globalPeriod = semantic;
  state.globalPeriodRange = this.resolveGlobalPeriod(semantic);
  this.onGlobalFilterChange();
},

applyCustomRange() {
  const from = document.getElementById('gfbFromDate').value;
  const to   = document.getElementById('gfbToDate').value;
  if (!from || !to) return;
  document.getElementById('gfbCustomPopover').style.display = 'none';
  state.globalPeriod = 'custom';
  state.globalPeriodRange = { from, to };
  this.onGlobalFilterChange();
},

onGlobalFilterChange() {
  // Sync entity from dropdown
  const entitySel = document.getElementById('gfbEntitySel');
  if (entitySel) state.globalEntity = entitySel.value;

  // Update chips
  this.renderGfbChips();

  // Update topbar pills
  this.updateTopbarKPIs();

  // Re-render active page
  this.navigate(state.currentPage);
},

renderGfbChips() {
  const chips = document.getElementById('gfbChips');
  if (!chips) return;
  const parts = [];
  if (state.globalPeriod !== 'month') {
    parts.push(`<span class="gfb-chip" onclick="app.setGlobalPeriod('month')">${this.getPeriodLabel(state.globalPeriod)} ×</span>`);
  }
  if (state.globalEntity !== 'all') {
    parts.push(`<span class="gfb-chip" onclick="app.resetGlobalEntity()">${state.globalEntity} ×</span>`);
  }
  chips.innerHTML = parts.join('');
},

resetGlobalEntity() {
  state.globalEntity = 'all';
  const sel = document.getElementById('gfbEntitySel');
  if (sel) sel.value = 'all';
  this.onGlobalFilterChange();
},
```

- [ ] **Step 4: Show/hide filter bar in `navigate()`**

At the top of `navigate(page)`, add:

```js
// Show filter bar only on report/data pages
const FILTER_BAR_PAGES = new Set(['dashboard','inbox','ledger','journals','pnl','balance','cashflow','ratios','cfnotes','ap','reconcile','sales','productmix','forecast','invoices']);
const bar = document.getElementById('globalFilterBar');
if (bar) bar.style.display = FILTER_BAR_PAGES.has(page) ? 'flex' : 'none';
```

- [ ] **Step 5: Show filter bar after login**

In the `login()` method, after setting role/pages and showing main UI, call `this.renderGfbChips()` to initialize chip state.

- [ ] **Step 6: Open browser, login as COO. Verify filter bar appears on Dashboard but not if there's any inline settings/rules area. Click "Last Month" — page should reload with prior month data. Change entity — should reload with entity-filtered data.**

- [ ] **Step 7: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: global sticky filter bar with period/entity controls"
```

---

## Task 4: Topbar KPI Pills

**Files:**
- Modify: `index.html` — add 2 `<span>` elements to topbar right
- Modify: `styles.css` — add `.topbar-kpi` style
- Modify: `app.js` — add `updateTopbarKPIs()`, call from login and `onGlobalFilterChange()`

- [ ] **Step 1: Add pill spans to topbar in index.html**

In the topbar right section, find the theme toggle button. Insert the pills immediately before it:

```html
<span id="topbarBank" class="topbar-kpi" style="display:none">Bank: —</span>
<span id="topbarNet"  class="topbar-kpi" style="display:none">Net: —</span>
```

Start hidden (`style="display:none"`); revealed after login.

- [ ] **Step 2: Add CSS to styles.css**

```css
.topbar-kpi {
  font-size: 0.72rem; font-weight: 700; padding: 3px 10px;
  border-radius: 6px; background: var(--border2); color: var(--text2);
  white-space: nowrap;
}
```

- [ ] **Step 3: Add `updateTopbarKPIs()` to app.js**

```js
updateTopbarKPIs() {
  const bankEl = document.getElementById('topbarBank');
  const netEl  = document.getElementById('topbarNet');
  if (!bankEl || !netEl || !window._bankAccounts) return;

  const entity = state.globalEntity;
  const accounts = entity === 'all'
    ? window._bankAccounts
    : window._bankAccounts.filter(a => a.entity === entity);

  const bankTotal = accounts.reduce((s, a) => s + a.balance, 0);
  bankEl.textContent = `Bank: ${this.fmtM(bankTotal)}`;
  bankEl.style.display = '';

  if (entity === 'all') {
    const net = bankTotal - (window._ccPayables || 0);
    netEl.textContent = `Net: ${this.fmtM(net)}`;
    netEl.style.color = net < 0 ? 'var(--red)' : '';
  } else {
    netEl.textContent = 'Net: —';
    netEl.title = 'CC payables shown for consolidated view only';
  }
  netEl.style.display = '';
},

// Helper: format large numbers as $1.25M or $234K
fmtM(n) {
  if (Math.abs(n) >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n/1e3)}K`;
  return `$${Math.round(n)}`;
},
```

- [ ] **Step 4: Call `updateTopbarKPIs()` after login succeeds (in `login()` method) and inside `onGlobalFilterChange()`**

`onGlobalFilterChange()` already calls it from Task 3 step 3. Add the login call.

- [ ] **Step 5: Verify in browser — after login, topbar shows "Bank: $1.25M Net: $694K". Switch entity to WBP — Bank updates to WBP-only total, Net shows "—".**

- [ ] **Step 6: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: topbar bank/net KPI pills, entity-aware"
```

---

## Task 5: Import Modal

**Files:**
- Modify: `index.html` — add import nav item in sidebar + `<dialog id="importModal">`
- Modify: `app.js` — add `openImportModal()`, `handleImportFile()`, `renderImportPreview()`, `submitImport()`
- Modify: `styles.css` — add import modal styles

- [ ] **Step 1: Add import nav item to sidebar in index.html**

After the last existing nav item, add:

```html
<li class="nav-item" data-page="import" data-roles="coo bookkeeper cpa admin" onclick="app.openImportModal()" style="display:none">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
  <span class="nav-label">Import Data</span>
</li>
```

Note: This nav item calls `openImportModal()` instead of `navigate()` — it opens a modal overlay rather than navigating to a page.

- [ ] **Step 2: Add `<dialog id="importModal">` to index.html, just before closing `</body>`**

```html
<dialog id="importModal" class="import-dialog">
  <div class="import-header">
    <h2 class="import-title">Import Data</h2>
    <button class="btn-icon" onclick="document.getElementById('importModal').close()">✕</button>
  </div>
  <div id="importStep1" class="import-step">
    <div class="import-dropzone" id="importDropzone" onclick="document.getElementById('importFileInput').click()"
         ondragover="event.preventDefault()" ondrop="app.handleImportDrop(event)">
      <div class="import-drop-icon">⬆</div>
      <div class="import-drop-text">Drop file here or click to browse</div>
      <div class="import-drop-sub">.xlsx · .csv · .qbo</div>
    </div>
    <input type="file" id="importFileInput" accept=".xlsx,.csv,.qbo,.xls" style="display:none" onchange="app.handleImportFile(this)">
  </div>
  <div id="importStep2" class="import-step" style="display:none">
    <h3 class="import-section-title">Column Mapping</h3>
    <div id="importMappingUI"></div>
    <h3 class="import-section-title" style="margin-top:16px">Preview (first 10 rows)</h3>
    <div class="tbl-wrap"><table class="data-table" id="importPreviewTable"></table></div>
    <div class="import-footer">
      <button class="btn-outline" onclick="app.resetImportModal()">← Back</button>
      <button class="btn-primary" onclick="app.submitImport()">Import to Supabase</button>
    </div>
  </div>
  <div id="importStep3" class="import-step" style="display:none">
    <div id="importResult"></div>
    <div class="import-footer">
      <button class="btn-primary" onclick="document.getElementById('importModal').close();app.resetImportModal()">Done</button>
    </div>
  </div>
</dialog>
```

- [ ] **Step 3: Add import modal CSS to styles.css**

```css
/* ---- IMPORT MODAL ---- */
.import-dialog {
  border: none; border-radius: 12px; padding: 0;
  background: var(--surface); color: var(--text);
  box-shadow: 0 8px 40px rgba(0,0,0,0.25);
  width: min(680px, 95vw); max-height: 90vh; overflow-y: auto;
}
.import-dialog::backdrop { background: rgba(0,0,0,0.55); }
.import-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 24px 0; margin-bottom: 16px;
}
.import-title { font-size: 1.1rem; font-weight: 700; }
.import-step { padding: 0 24px 24px; }
.import-dropzone {
  border: 2px dashed var(--border2); border-radius: 10px;
  padding: 40px 20px; text-align: center; cursor: pointer;
  transition: border-color 0.15s;
}
.import-dropzone:hover { border-color: var(--accent); }
.import-drop-icon { font-size: 2rem; margin-bottom: 8px; }
.import-drop-text { font-size: 0.9rem; font-weight: 600; color: var(--text); }
.import-drop-sub { font-size: 0.75rem; color: var(--text3); margin-top: 4px; }
.import-section-title { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text3); margin-bottom: 8px; }
.import-mapping-row { display: grid; grid-template-columns: 1fr 24px 1fr; gap: 8px; align-items: center; margin-bottom: 6px; font-size: 0.8rem; }
.import-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
```

- [ ] **Step 4: Add import JS methods to app.js**

```js
openImportModal() {
  this.resetImportModal();
  document.getElementById('importModal').showModal();
},

resetImportModal() {
  document.getElementById('importStep1').style.display = '';
  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('importStep3').style.display = 'none';
  document.getElementById('importFileInput').value = '';
  this._importData = null;
},

handleImportDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) this._processImportFile(file);
},

handleImportFile(input) {
  const file = input.files[0];
  if (file) this._processImportFile(file);
},

_processImportFile(file) {
  // Reuse existing readSpreadsheetFile() — already handles .xlsx and .csv via SheetJS
  this.readSpreadsheetFile(file, (headers, rows) => {
    this._importData = { headers, rows };
    this._renderImportStep2(headers, rows);
  });
},

_renderImportStep2(headers, rows) {
  document.getElementById('importStep1').style.display = 'none';
  document.getElementById('importStep2').style.display = '';

  // Column mapping UI
  const TXN_FIELDS = ['date', 'description', 'amount', 'entity', 'account_id'];
  const mappingUI = document.getElementById('importMappingUI');
  mappingUI.innerHTML = TXN_FIELDS.map(f => {
    const bestGuess = headers.findIndex(h => h.toLowerCase().includes(f)) ?? 0;
    const opts = headers.map((h,i) => `<option value="${i}" ${i===bestGuess?'selected':''}>${h}</option>`).join('');
    return `<div class="import-mapping-row">
      <span>${f}</span><span>←</span>
      <select id="map_${f}" class="import-map-sel">${opts}</select>
    </div>`;
  }).join('');

  // Preview table (first 10 rows)
  const preview = document.getElementById('importPreviewTable');
  const sample = rows.slice(0, 10);
  preview.innerHTML = `
    <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${sample.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')}</tbody>`;
},

async submitImport() {
  if (!this._importData) return;
  const { headers, rows } = this._importData;
  const TXN_FIELDS = ['date', 'description', 'amount', 'entity', 'account_id'];
  const mapping = {};
  TXN_FIELDS.forEach(f => {
    const sel = document.getElementById(`map_${f}`);
    if (sel) mapping[f] = parseInt(sel.value, 10);
  });

  const records = rows.map(row => ({
    acc_date:    row[mapping.date]        || null,
    description: row[mapping.description] || '',
    amount:      parseFloat(row[mapping.amount]) || 0,
    entity:      row[mapping.entity]      || '',
    account_id:  row[mapping.account_id]  || null,
    status:      'unclassified',
  })).filter(r => r.acc_date && r.amount !== 0);

  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('importStep3').style.display = '';
  document.getElementById('importResult').innerHTML = '<p>Importing…</p>';

  const { data, error } = await supabaseClient
    .from('transactions')
    .insert(records);

  if (error) {
    document.getElementById('importResult').innerHTML = `<p style="color:var(--red)">Error: ${error.message}</p>`;
  } else {
    document.getElementById('importResult').innerHTML = `<p style="color:var(--green)">✓ Imported ${records.length} transactions successfully.</p>`;
    this.showToast(`${records.length} transactions imported`, 'success');
  }
},
```

- [ ] **Step 5: Verify in browser — click Import Data in sidebar, modal opens. Drop a CSV file — step 2 shows with column mapping and preview. Click Import — shows success message.**

- [ ] **Step 6: Commit**

```bash
git add app.js index.html styles.css
git commit -m "feat: import modal with drag-drop, column mapping, Supabase bulk insert"
```

---

## Sprint 1 QA Checklist

Open `index.html` in browser and verify:

- [ ] Login with `wb-admin-2026` → all 17 sidebar items visible (including Import Data)
- [ ] Login with `wb-coo-2026` → only COO pages visible
- [ ] Filter bar appears on Dashboard, P&L, Invoices; does NOT appear if you open settings/rules areas
- [ ] "Last Month" button turns blue, data reloads with prior month; chip appears with "×" to dismiss
- [ ] "YTD" button: period label in page titles updates to show "YTD 2026"
- [ ] "Custom ▾": date popover opens, fill dates, click Apply → data reloads
- [ ] Entity dropdown: select "WBP" → chip appears, topbar Bank pill updates to WBP balance only, Net shows "—"
- [ ] Click "×" on entity chip → resets to All Entities
- [ ] Topbar shows Bank and Net pills after login (all entities consolidated)
- [ ] Import modal: opens from sidebar, accepts .xlsx and .csv, shows 10-row preview, submits to Supabase
- [ ] Dark mode: filter bar, pills, and import modal all render correctly in dark theme
