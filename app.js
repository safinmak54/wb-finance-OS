// ============================================================
// WB BRANDS FINANCE OS — Application Logic
// ============================================================

// ---- SUPABASE CONFIG ----
// 1. Go to https://supabase.com → your wb-finance-os project → Settings → API
// 2. Copy "Project URL" and "anon public" key
// 3. Paste them below, then refresh the page
const SUPABASE_URL = 'https://fxwjadkbvlvxtxxkjqkw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4d2phZGtidmx2eHR4eGtqcWt3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MjU5MDIsImV4cCI6MjA4OTAwMTkwMn0.nrLSqv0rPrMNlIQHjlKxNS8U3k-_R33ADKcteVUO410';

let supabaseClient = null;

// Runtime lookup maps (populated on load)
window._entityByCode = {};   // code → uuid
window._entityById   = {};   // uuid → code
window._accountById  = {};   // uuid → name
window._vendorByName = {};   // name → uuid

// ---- ROLES ----
const ROLES = {
  coo:        { pass: 'wb-coo-2026',   label: 'COO View'        },
  bookkeeper: { pass: 'wb-books-2026', label: 'Bookkeeper View' },
  cpa:        { pass: 'wb-cpa-2026',   label: 'CPA View'        },
  admin:      { pass: 'wb-admin-2026', label: 'Admin'           },
};

// ---- ENTITY GROUPS ----
const ENTITY_GROUPS = {
  wb_full:   ['WBP','LP','KP','BP','SWAG','RUSH'],
  one_ops:   ['ONEOPS'],
  sp_brands: ['SP1'],
};

// Bank account name → entity code (most specific patterns first)
const BANK_ACCOUNT_ENTITY_MAP = [
  { keywords: ['lanyard', 'lp bank', 'lp '],          code: 'LP'     },
  { keywords: ['kooler'],                               code: 'KP'     },
  { keywords: ['band promo'],                           code: 'BP'     },
  { keywords: ['wb promo', 'wbp'],                      code: 'WBP'    },
  { keywords: ['wb brand', 'wb '],                      code: 'WBP'    },
  { keywords: ['rush'],                                 code: 'RUSH'   },
  { keywords: ['swag'],                                 code: 'SWAG'   },
  { keywords: ['sp brand', ' sp '],                     code: 'SP1'    },
  { keywords: ['one op', 'oneop', 'one operations'],    code: 'ONEOPS' },
];
function detectEntityFromBankAccount(name) {
  if (!name) return null;
  const lower = (' ' + name + ' ').toLowerCase();
  for (const entry of BANK_ACCOUNT_ENTITY_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) return entry.code;
  }
  return null;
}

function applyEntityFilter(query, entity) {
  if (!entity || entity === 'all') return query;
  if (ENTITY_GROUPS[entity]) return query.in('entity', ENTITY_GROUPS[entity]);
  return query.eq('entity', entity);
}

// ---- DATA STORE ----
// Data is loaded exclusively from Supabase. No hardcoded fallback.
const DATA = {
  transactions: [],
  vendors: [],
  invoices: [],
  journals: [],
  coa: [],
  banks: [],
  classificationRules: []
};

// ---- SUPABASE DATA LOADER ----
async function loadDataFromSupabase() {
  try {
    // Build entity lookup maps
    const { data: entities, error: entErr } = await supabaseClient
      .from('entities').select('id, code');
    if (entErr) throw entErr;
    window._entityByCode = {};
    window._entityById = {};
    (entities || []).forEach(e => {
      const code = (e.code || '').trim().toUpperCase();
      window._entityByCode[code] = e.id;
      window._entityByCode[e.code] = e.id; // also keep original casing
      window._entityById[e.id] = code;
    });

    // Build account lookup maps
    const { data: accounts, error: accErr } = await supabaseClient
      .from('accounts').select('id, account_code, account_name');
    if (accErr) throw accErr;
    window._accountById = {};
    (accounts || []).forEach(a => {
      window._accountById[a.id] = a.account_name;
    });

    // Populate DATA.coa for COA page render
    DATA.coa = (accounts || []).map(a => ({
      id: a.id,
      code: a.account_code,
      name: a.account_name,
      type: a.account_type,
      subtype: a.account_subtype,
      line: a.line || a.account_name,
      balance: 0,  // live balance computed in Phase 3
      elimination: a.is_elimination || false
    }));

    // Load transactions
    const { data: txns, error: txnErr } = await supabaseClient
      .from('raw_transactions')
      .select('*')
      .order('accounting_date', { ascending: false });
    if (!txnErr) {
      DATA.transactions = (txns || []).map(t => ({
        id: t.id,
        entity: window._entityById[t.entity_id] || '',
        desc: t.description || '',
        vendor: t.vendor || '',
        type: t.txn_type || 'expense',
        category: t.category || '',
        amount: t.direction === 'DEBIT' ? -Number(t.amount) : Number(t.amount),
        txnDate: t.transaction_date,
        accDate: t.accounting_date,
        status: t.status || 'review',
        source: t.source || 'manual'
      }));
      state.filteredTxns = [...DATA.transactions];
      // Always update sidebar inbox badge with unclassified count
      const badge = document.getElementById('reviewBadge');
      if (badge) badge.textContent = (txns || []).filter(t => !t.classified).length || '';
    }

    // Load vendors
    const { data: vendors, error: venErr } = await supabaseClient
      .from('vendors').select('*').order('name');
    if (!venErr) {
      DATA.vendors = (vendors || []).map(v => ({
        id: v.id,
        name: v.name,
        type: v.vendor_type || 'other',
        ytd: Number(v.ytd_spend) || 0,
        openInvoices: v.open_invoices || 0,
        overdue: v.overdue_count || 0,
        lastPayment: v.last_payment || '',
        status: v.status || 'active'
      }));
      // Rebuild vendor name map
      window._vendorByName = {};
      DATA.vendors.forEach(v => { window._vendorByName[v.name] = v.id; });
      // Always update overdue badge (clears hardcoded value when DB is empty)
      const overdueCount = DATA.vendors.filter(v => v.overdue > 0).length;
      const vBadge = document.getElementById('overdueVendorBadge');
      if (vBadge) vBadge.textContent = overdueCount || '';
    }

    // Load invoices with vendor name
    const { data: invoices, error: invErr } = await supabaseClient
      .from('invoices')
      .select('*, vendors(name)')
      .order('invoice_date', { ascending: false });
    if (!invErr && invoices && invoices.length > 0) {
      DATA.invoices = invoices.map(i => ({
        id: i.id,
        vendor: i.vendors?.name || '',
        invoiceNum: i.invoice_number,
        date: i.invoice_date,
        due: i.due_date,
        amount: Number(i.amount),
        paid: Number(i.amount_paid) || 0,
        status: i.status || 'open'
      }));
    }

    // Load journal entries with ledger lines
    const { data: journals, error: jeErr } = await supabaseClient
      .from('journal_entries')
      .select('id, accounting_date, description, entry_type, entity_id, ledger_entries(debit_amount, credit_amount, memo, account_id)')
      .order('accounting_date', { ascending: false });
    if (!jeErr && journals && journals.length > 0) {
      DATA.journals = [];
      journals.forEach(je => {
        const shortId = 'JE-' + je.id.replace(/-/g, '').substring(0, 6).toUpperCase();
        (je.ledger_entries || []).forEach(line => {
          DATA.journals.push({
            id: shortId,
            memo: line.memo || je.description,
            account: window._accountById[line.account_id] || '',
            debit: Number(line.debit_amount) || 0,
            credit: Number(line.credit_amount) || 0,
            date: je.accounting_date,
            entity: window._entityById[je.entity_id] || '',
            type: je.entry_type || 'standard'
          });
        });
      });
    }

    // Load classification rules
    const { data: rules } = await supabaseClient
      .from('classification_rules').select('*').eq('is_active', true).order('created_at');
    DATA.classificationRules = rules || [];

  } catch (err) {
    console.error('Supabase load error:', err);
    app.toast('Connection error — check Supabase credentials and refresh');
    document.getElementById('pageTitle').textContent = 'Connection Error';
    document.getElementById('pageSub').textContent = 'Could not connect to database. Check console for details.';
  }
}

// ---- APP STATE ----
const state = {
  currentPage: 'dashboard',
  globalEntity: 'all',
  globalPeriod: 'month',
  globalPeriodRange: (() => {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const from = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
    const to = now.toISOString().slice(0,10);
    return { from, to };
  })(),
  txnPage: 1,
  txnPageSize: 15,
  txnSort: { field: 'accDate', dir: 'desc' },
  filteredTxns: [...DATA.transactions],
  charts: {},
  pnlEntities: [],   // empty = all/consolidated; filled = selected entity codes
  pnlMode: 'summary',
  inboxMode: 'bank',  // 'bank' | 'internal' | 'cc'
  inboxFilter: { search: '', from: '', to: '', entity: '', direction: '' },
  ledgerFilter: { search: '', account: '', direction: '' },
};

// P&L comparison data (from localStorage, set at render time)
let _pnlCmp = null;
function _pnlNorm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// ---- MAIN APP OBJECT ----
const app = {
  // Navigation
  navigate(page) {
    // Show filter bar only on report/data pages
    const FILTER_BAR_PAGES = new Set(['dashboard','inbox','cc-inbox','ledger','journals','pnl','balance','cashflow','ratios','cfnotes','ap','reconcile','sales','productmix','forecast','invoices']);
    const bar = document.getElementById('globalFilterBar');
    if (bar) bar.style.display = FILTER_BAR_PAGES.has(page) ? 'flex' : 'none';

    if (page !== 'inbox') { this._inboxLoadAll = false; } // reset pagination on nav away
    if (page !== 'cc-inbox') { this._ccLoadAll = false; }
    if (page !== 'ledger') { state.ledgerFilter = { search: '', account: '', direction: '' }; }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    const navEl = document.querySelector(`[data-page="${page}"]`);
    if (navEl) navEl.classList.add('active');
    state.currentPage = page;

    const period = this.getPeriodLabel(state.globalPeriod);

    // Update dynamic chart titles
    // revenueChartTitle no longer exists — title is static in HTML with emoji
    const cfTitle = document.getElementById('cashflowTitle');
    if (cfTitle) cfTitle.textContent = `Cash Flow Statement — ${period}`;

    const titles = {
      dashboard:  ['Dashboard', `${period} · Consolidated view`],
      inbox:      ['Bank Transactions', 'Unclassified bank transactions'],
      ledger:     ['Ledger', `Classified transactions · ${period}`],
      journals:   ['Journal Entries', 'Double-entry ledger'],
      reconcile:  ['Reconciliation', `Bank vs book · ${period}`],
      vendors:    ['Vendors', 'Payables management'],
      invoices:   ['Invoices', 'Vendor invoices'],
      pnl:        ['Profit & Loss', `Consolidated · ${period}`],
      balance:    ['Balance Sheet', `As of ${period}`],
      cashflow:   ['Cash Flow', period],
      coa:        ['Chart of Accounts', 'WB Brands LLC · All entities'],
      banks:      ['Bank Connections', 'Connected accounts & processors'],
      forecast:   ['Cash Forecast', '13-week rolling model'],
      ratios:     ['Ratios & KPIs', 'Financial health metrics'],
      cfnotes:    ['CFO Notes', 'GAAP compliance & tax planning'],
      sales:      ['Sales Metrics', 'Revenue performance'],
      productmix: ['Product Mix', 'Category & channel breakdown'],
      ap:             ['AP / Payables', 'Outstanding payables & aging'],
      'cc-inbox':     ['Credit Card Transactions', 'Unclassified CC charges'],
      'cash-balances': ['Cash Balances', 'Manually-updated multi-entity cash position'],
    };
    const [title, sub] = titles[page] || ['—', ''];
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageSub').textContent = sub;

    // Close sidebar on mobile after navigation
    if (window.innerWidth <= 768) this.closeSidebar();

    // Render page-specific content
    setTimeout(async () => {
      if (page === 'dashboard')    await this.updateDashboardKPIs();
      if (page === 'inbox')        await this.renderInbox();
      if (page === 'ledger')       await this.renderLedger();
      if (page === 'vendors')      this.renderVendors();
      if (page === 'invoices')     this.renderInvoices();
      if (page === 'pnl')          await this.renderPnl();
      if (page === 'balance')      await this.renderBalance();
      if (page === 'journals')     await this.renderJournals();
      if (page === 'coa')          this.renderCOA();
      if (page === 'banks')        this.renderBanks();
      if (page === 'reconcile')    await this.renderReconcile();
      if (page === 'cashflow')     await this.renderCashflow();
      if (page === 'forecast')     this.renderCashForecast();
      if (page === 'cash-balances') await this.renderCashBalances();
      if (page === 'ratios')       await this.renderRatios();
      if (page === 'cfnotes')      this.renderCfoNotes();
      if (page === 'sales')        this.renderSales();
      if (page === 'productmix')   this.renderProductMix();
      if (page === 'ap')           await this.renderAP();
      if (page === 'cc-inbox')     await this.renderCCInbox();
    }, 10);
  },

  async setEntity(val) {
    state.globalEntity = val;
    const pg = state.currentPage;
    if (pg === 'inbox')        await this.renderInbox();
    else if (pg === 'ledger') await this.renderLedger();
    else if (pg === 'vendors')  this.renderVendors();
    else if (pg === 'invoices') this.renderInvoices();
    else if (pg === 'pnl')      await this.renderPnl();
    else if (pg === 'balance')  await this.renderBalance();
    else if (pg === 'dashboard') await this.updateDashboardKPIs();
  },

  setPeriod(val) {
    state.globalPeriod = val;
    state.globalPeriodRange = this.resolveGlobalPeriod(val);
    // Deactivate all filter-bar period buttons — a specific month isn't represented by any
    document.querySelectorAll('.gfb-btn[data-period]').forEach(b => b.classList.remove('active'));
    this.navigate(state.currentPage);
  },

  // Sync topbar period picker dropdown to match a semantic period selection
  _syncPeriodPicker(semantic) {
    const picker = document.getElementById('periodPicker');
    if (!picker) return;
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    if (semantic === 'month') {
      picker.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}`;
    } else if (semantic === 'last-month') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      picker.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
    } else {
      picker.value = '';
    }
  },

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
    // YYYY-MM format from legacy period picker
    if (/^\d{4}-\d{2}$/.test(semantic)) {
      const [year, month] = semantic.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      return { from: `${semantic}-01`, to: `${semantic}-${String(lastDay).padStart(2,'0')}` };
    }
    // fallback: current month
    return { from: `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`, to: today };
  },

  getPeriodLabel(val) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    if (!val) return 'Current Period';
    if (val === 'month') {
      const now = new Date();
      return `${months[now.getMonth()]} ${now.getFullYear()}`;
    }
    if (val === 'last-month') {
      const d = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
      return `${months[d.getMonth()]} ${d.getFullYear()}`;
    }
    if (val === 'qtd') return `Q${Math.ceil((new Date().getMonth()+1)/3)} ${new Date().getFullYear()} to date`;
    if (val === 'ytd') return `YTD ${new Date().getFullYear()}`;
    if (val === 'custom') return 'Custom Range';
    // Legacy YYYY-MM format support
    if (/^\d{4}-\d{2}$/.test(val)) {
      const [year, month] = val.split('-');
      return `${months[parseInt(month,10)-1]} ${year}`;
    }
    return val;
  },

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
    // Sync topbar dropdown to match
    this._syncPeriodPicker(semantic);
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
    if (typeof this.updateTopbarKPIs === 'function') this.updateTopbarKPIs();

    // Re-render active page
    this.navigate(state.currentPage);
  },

  // ---- INBOX MODE / FILTER HELPERS ----
  setInboxMode(mode) {
    state.inboxMode = mode;
    state.inboxFilter = { search: '', from: '', to: '', entity: '', direction: '' };
    this.renderInbox();
  },

  applyInboxFilters(query) {
    const f = state.inboxFilter;
    if (f.search)    query = query.ilike('description', `%${f.search}%`);
    if (f.from)      query = query.gte('transaction_date', f.from);
    if (f.to)        query = query.lte('transaction_date', f.to);
    if (f.entity)    query = query.eq('entity_id', window._entityByCode[f.entity] || f.entity);
    if (f.direction) query = query.eq('direction', f.direction);
    return query;
  },

  updateInboxFilter(field, value) {
    state.inboxFilter[field] = value;
    this.renderInbox();
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

  normalizeDate(str) {
    if (!str) return str;
    // Strip time component from ISO datetime: "2026-01-15 00:00:00" or "2026-01-15T00:00:00Z"
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(str)) return str.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    // YYYYMMDD (bank feed format: 20251231)
    const m3 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;
    // MM/DD/YYYY or M/D/YYYY
    const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    // MM-DD-YYYY or M-D-YYYY
    const m2 = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (m2) return `${m2[3]}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
    // MM/DD/YY (e.g. 01/15/26)
    const m4 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (m4) return `20${m4[3]}-${m4[1].padStart(2,'0')}-${m4[2].padStart(2,'0')}`;
    return str;
  },

  getActiveTxns() {
    const from = state.globalPeriodRange.from;
    const to = state.globalPeriodRange.to;
    return DATA.transactions.filter(t => t.accDate && t.accDate >= from && t.accDate <= to);
  },

  // ---- TRANSACTIONS ----
  onTxnSearchInput() {
    this.filterTransactions();
    const input = document.getElementById('txnSearch');
    const dropdown = document.getElementById('txnSuggest');
    if (!input || !dropdown) return;
    const q = input.value.trim().toLowerCase();
    if (!q) { dropdown.classList.remove('open'); return; }

    // Build unique suggestion list from vendor names + descriptions
    const seen = new Set();
    const suggestions = [];
    DATA.transactions.forEach(t => {
      [t.vendor, t.desc].forEach(val => {
        if (val && !seen.has(val.toLowerCase()) && val.toLowerCase().includes(q)) {
          seen.add(val.toLowerCase());
          suggestions.push(val);
        }
      });
    });

    if (!suggestions.length) { dropdown.classList.remove('open'); return; }

    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    dropdown.innerHTML = suggestions.slice(0, 10).map(s =>
      `<div class="autocomplete-item" onmousedown="app.selectTxnSuggest(this)">${s.replace(re, '<mark>$1</mark>')}</div>`
    ).join('');
    dropdown.classList.add('open');
  },

  selectTxnSuggest(el) {
    const input = document.getElementById('txnSearch');
    // Strip HTML tags to get plain text value
    input.value = el.textContent;
    document.getElementById('txnSuggest').classList.remove('open');
    this.filterTransactions();
  },

  filterTransactions() {
    const entity = document.getElementById('txnEntityFilter')?.value || '';
    const type = document.getElementById('txnTypeFilter')?.value || '';
    const status = document.getElementById('txnStatusFilter')?.value || '';
    const search = document.getElementById('txnSearch')?.value.toLowerCase() || '';

    state.filteredTxns = this.getActiveTxns().filter(t => {
      if (entity && t.entity !== entity) return false;
      if (type && t.type !== type) return false;
      if (status && t.status !== status) return false;
      if (search && !t.desc.toLowerCase().includes(search) && !t.vendor.toLowerCase().includes(search)) return false;
      return true;
    });
    state.txnPage = 1;
    this.renderTransactionRows();
  },

  sortTable(field) {
    if (state.txnSort.field === field) state.txnSort.dir = state.txnSort.dir === 'asc' ? 'desc' : 'asc';
    else { state.txnSort.field = field; state.txnSort.dir = 'desc'; }
    const dir = state.txnSort.dir === 'asc' ? 1 : -1;
    state.filteredTxns.sort((a, b) => {
      if (field === 'amount') return (Math.abs(a.amount) - Math.abs(b.amount)) * dir;
      return (a[field] || '').localeCompare(b[field] || '') * dir;
    });
    this.renderTransactionRows();
  },

  renderTransactions() {
    state.filteredTxns = this.getActiveTxns();
    this.renderTransactionRows();
  },

  renderTransactionRows() {
    const start = (state.txnPage - 1) * state.txnPageSize;
    const page = state.filteredTxns.slice(start, start + state.txnPageSize);
    const tbody = document.getElementById('txnBody');
    tbody.innerHTML = page.map(t => {
      const amtClass = t.type === 'income' ? 'amount-pos' : t.type === 'transfer' ? 'amount-neu' : 'amount-neg';
      const amtSign = t.type === 'income' ? '+' : t.type === 'transfer' ? '' : '';
      const amt = `${amtSign}${fmt(t.amount)}`;
      const typeBadge = `<span class="badge badge-${t.type}">${t.type}</span>`;
      const statusBadge = `<span class="badge badge-${t.status}">${t.status === 'confirmed' ? 'Confirmed' : 'Needs review'}</span>`;
      return `<tr>
        <td><input type="checkbox"/></td>
        <td>${t.accDate}</td>
        <td>${t.txnDate}</td>
        <td><span class="badge badge-${t.entity === 'WB' ? 'income' : 'transfer'}" style="font-size:10px">${t.entity}</span></td>
        <td style="max-width:200px">
          <div style="font-weight:500;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.desc}</div>
          ${t.vendor ? `<div style="font-size:10px;color:var(--text3)">${t.vendor}</div>` : ''}
        </td>
        <td>${typeBadge}</td>
        <td style="font-size:11px;color:var(--text2);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.category}</td>
        <td class="${amtClass}">${amt}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="action-btn" onclick="app.editTransaction('${t.id}')">Edit</button>
            ${t.status === 'review' ? `<button class="action-btn primary" onclick="app.confirmTxn('${t.id}')">Confirm</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    document.getElementById('txnCount').textContent = `Showing ${start+1}–${Math.min(start+state.txnPageSize, state.filteredTxns.length)} of ${state.filteredTxns.length} transactions`;
    this.renderPagination();
  },

  renderPagination() {
    const total = Math.ceil(state.filteredTxns.length / state.txnPageSize);
    const pg = document.getElementById('pagination');
    pg.innerHTML = Array.from({length: total}, (_, i) =>
      `<button class="page-btn ${i+1 === state.txnPage ? 'active' : ''}" onclick="app.goPage(${i+1})">${i+1}</button>`
    ).join('');
  },

  goPage(n) { state.txnPage = n; this.renderTransactionRows(); },
  selectAll(cb) { document.querySelectorAll('#txnBody input[type="checkbox"]').forEach(c => c.checked = cb.checked); },

  async confirmTxn(id) {
    const t = DATA.transactions.find(x => x.id === id);
    if (t) {
      t.status = 'confirmed';
      this.renderTransactionRows();
      this.toast('Transaction confirmed');
      // Update review badge
      const reviewCount = DATA.transactions.filter(x => x.status === 'review').length;
      const badge = document.getElementById('reviewBadge');
      if (badge) badge.textContent = reviewCount || '';

      if (supabaseClient) {
        const { error } = await supabaseClient
          .from('raw_transactions')
          .update({ status: 'confirmed' })
          .eq('id', id);
        if (error) console.error('Confirm error:', error);
      }
    }
  },

  editTransaction(id) {
    const t = DATA.transactions.find(x => x.id === id) || {};
    this.openModal('editTransaction', t);
  },

  // ---- REPORT DATA HELPERS ----
  async fetchReportData(entity, periodRange) {
    // periodRange = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
    const range = periodRange || state.globalPeriodRange;
    let txnQuery = supabaseClient
      .from('transactions')
      .select('amount, account_id, accounts(id, account_code, account_name, account_type, account_subtype, line, is_elimination)')
      .gte('acc_date', range.from)
      .lte('acc_date', range.to);
    // entity can be a string (single/group/all) or an array of entity codes
    if (Array.isArray(entity) && entity.length > 0) txnQuery = txnQuery.in('entity', entity);
    else txnQuery = applyEntityFilter(txnQuery, entity);
    const { data: txns, error: txnErr } = await txnQuery;
    if (txnErr) { console.error('Report txn error:', txnErr); return null; }

    const { data: journals } = await supabaseClient
      .from('journal_entries')
      .select('id, accounting_date, description, entry_type, period, entity_id, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name, account_type, account_subtype))')
      .gte('period', range.from.slice(0,7))
      .lte('period', range.to.slice(0,7));

    const flatJournals = (journals || []).map(je => ({
      ...je,
      netAmount: (je.ledger_entries || []).reduce((s, l) =>
        s + (Number(l.debit_amount || 0) - Number(l.credit_amount || 0)), 0)
    }));

    return { txns: txns || [], journals: flatJournals };
  },

  groupByAccount(txns) {
    const groups = {};
    for (const t of txns) {
      const acct = t.accounts;
      if (!acct) continue;
      if (!groups[t.account_id]) groups[t.account_id] = { account: acct, total: 0 };
      groups[t.account_id].total += Number(t.amount);
    }
    return groups;
  },

  // ---- P&L REPORT ----
  async renderPnl() {
    const mode = state.pnlMode || 'summary';
    const entity = state.pnlEntities && state.pnlEntities.length > 0 ? state.pnlEntities : state.globalEntity;
    const range = state.globalPeriodRange;

    const data = await this.fetchReportData(entity, range);
    if (!data) {
      const el = document.getElementById('pnlReport');
      if (el) el.innerHTML = '<div style="padding:32px;color:var(--red)">Failed to load report</div>';
      return;
    }

    if (mode === 'summary') {
      this._renderPnlSummary(data);
    } else if (mode === 'detail') {
      this._renderPnlDetail(data);
    } else if (mode === 'entity') {
      await this._renderPnlByEntity(range);
    } else if (mode === 'prior') {
      await this._renderPnlVsPrior(data, range);
    } else if (mode === 'budget') {
      await this._renderPnlVsBudget(data, range);
    }

    await this._renderPnlCharts(data, range);
  },

  _renderPnlSummary(data) {
    const entity = state.pnlEntities && state.pnlEntities.length > 0 ? state.pnlEntities : state.globalEntity;
    const period = state.globalPeriod;
    const el = document.getElementById('pnlReport');
    el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

    // Load comparison data from localStorage
    try { const s = localStorage.getItem('pnlComparison'); _pnlCmp = s ? JSON.parse(s).data : null; }
    catch(e) { _pnlCmp = null; }
    if (_pnlCmp) el.classList.add('comparing'); else el.classList.remove('comparing');

    supabaseClient.from('closed_periods').select('closed_at').eq('period', state.globalPeriodRange.from.slice(0,7)).maybeSingle()
      .then(closedRow => {
        const isClosed = !!(closedRow?.data);

        const groups = this.groupByAccount(data.txns);
        const bySubtype = (sub) => Object.values(groups).filter(g => g.account.account_subtype === sub && !g.account.is_elimination);
        const byType = (type, excludeSubs = []) => Object.values(groups).filter(g => g.account.account_type === type && !g.account.is_elimination && !excludeSubs.includes(g.account.account_subtype));
        const sumLines = (lines) => lines.reduce((s, g) => s + g.total, 0);
        const renderLines = (lines, isExpense = false) => lines.map(g =>
          pnlLine(`${g.account.account_code} — ${g.account.account_name}`, isExpense ? Math.abs(g.total) : g.total, 2, '', g.account.id)
        ).join('');

        const revenueLines = byType('revenue', ['contra']);
        const contraLines  = bySubtype('contra');
        const cogsLines    = bySubtype('cogs');
        const adLines      = bySubtype('advertising');
        const payrollLines = bySubtype('payroll');
        const platformLines= bySubtype('platform');
        const opexLines    = byType('expense', ['cogs','advertising','payroll','platform','commission']);

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

        const adjusting = (data.journals || []).filter(j => j.entry_type === 'adjusting');
        const totalAdj  = adjusting.reduce((s, j) => s + (j.netAmount || 0), 0);
        const netProfit = noi + totalAdj;
        const marginPct = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : '—';
        const grossPct  = totalIncome > 0 ? ((grossProfit / totalIncome) * 100).toFixed(1) : '—';

        const entityLabel = Array.isArray(entity) ? entity.join(', ') : (entity === 'all' ? 'Consolidated' : entity);
        const cmpMeta = _pnlCmp ? JSON.parse(localStorage.getItem('pnlComparison') || '{}') : null;
        el.innerHTML = `
          <div class="report-header">
            <h2>Profit & Loss Statement</h2>
            <p>WB Brands LLC — ${entityLabel} · ${this.getPeriodLabel(period)} · Accrual basis</p>
            ${cmpMeta ? `<p style="font-size:11px;color:var(--accent);margin-top:4px">Comparing vs: ${cmpMeta.label || 'Prior period'} · <button class="btn-outline" style="font-size:11px;padding:1px 8px" onclick="app.clearComparison()">Clear</button></p>` : ''}
          </div>
          ${_pnlCmp ? `<div class="report-cmp-header"><span>Account</span><span>${this.getPeriodLabel(period)}</span><span>${cmpMeta?.label || 'Prior'}</span><span>Variance</span></div>` : ''}
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
            ${adjusting.map(j => pnlLine(j.description || 'Adjustment', j.netAmount, 1)).join('')}
            ${pnlTotal('Total Adjustments', totalAdj, totalAdj >= 0 ? 'pos' : 'neg')}
          ` : ''}
          ${pnlGrand('Net Profit', netProfit, netProfit >= 0 ? 'pos' : 'neg')}
          ${pnlLine(`Net margin: ${marginPct}%`, null, 1, 'muted')}
          ${isClosed && totalAdj !== 0 ? `
            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-top:12px">
              <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:8px">Period Comparison</p>
              <table style="width:100%;font-size:13px">
                <tr><td>Cash basis net income</td><td style="text-align:right">${fmt(noi)}</td></tr>
                <tr><td>Adjusting entries</td><td style="text-align:right">${totalAdj >= 0 ? fmt(totalAdj) : '(' + fmt(Math.abs(totalAdj)) + ')'}</td></tr>
                <tr style="font-weight:600;border-top:1px solid var(--border)"><td>Accrual basis net income</td><td style="text-align:right">${fmt(netProfit)}</td></tr>
              </table>
            </div>
          ` : ''}
          ${isClosed ? `<div style="margin-top:8px;font-size:12px;color:var(--text3)">✓ Period closed</div>` : ''}
          ${totalIncome === 0 ? `<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">No transactions classified for this period/entity.</div>` : ''}
        `;
      });
  },

  _renderPnlDetail(data) {
    const container = document.getElementById('pnlReport');
    const groups = {};
    (data.txns || []).forEach(t => {
      const type = t.accounts?.account_type || 'Other';
      const sub  = t.accounts?.account_subtype || 'General';
      if (!groups[type]) groups[type] = {};
      if (!groups[type][sub]) groups[type][sub] = 0;
      groups[type][sub] += t.amount || 0;
    });

    let html = '<table class="data-table"><thead><tr><th>Category</th><th>Sub-category</th><th class="r">Amount</th><th class="r">% Rev</th></tr></thead><tbody>';
    const revenue = Object.values(groups.revenue || groups.Revenue || {}).reduce((s,v)=>s+v,0) || 1;

    Object.entries(groups).forEach(([type, subs]) => {
      const typeTotal = Object.values(subs).reduce((s,v)=>s+v,0);
      html += `<tr class="section-header"><td colspan="2"><strong>${type}</strong></td><td class="r"><strong>${fmt(typeTotal)}</strong></td><td class="r">${(typeTotal/revenue*100).toFixed(1)}%</td></tr>`;
      Object.entries(subs).forEach(([sub, amt]) => {
        html += `<tr><td></td><td>${sub}</td><td class="r">${fmt(amt)}</td><td class="r">${(amt/revenue*100).toFixed(1)}%</td></tr>`;
      });
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  _summarizePnlData(data) {
    if (!data) return {};
    const txns = data.txns || [];
    // account_type values are lowercase in Supabase ('revenue', 'cogs', 'expense')
    const rev  = txns.filter(t=>t.accounts?.account_type==='revenue').reduce((s,t)=>s+t.amount,0);
    const cogs = txns.filter(t=>t.accounts?.account_type==='cogs').reduce((s,t)=>s+Math.abs(t.amount),0);
    const opex = txns.filter(t=>t.accounts?.account_type==='expense').reduce((s,t)=>s+Math.abs(t.amount),0);
    const gp   = rev - cogs;
    return { Revenue: rev, COGS: cogs, 'Gross Profit': gp, 'Operating Expenses': opex, 'Net Income': gp - opex };
  },

  async _renderPnlByEntity(range) {
    const ENTITIES = ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS'];
    const container = document.getElementById('pnlReport');
    container.innerHTML = '<p style="color:var(--text3)">Loading by-entity data…</p>';

    const results = await Promise.all(ENTITIES.map(e => this.fetchReportData(e, range)));
    const cats = ['Revenue','COGS','Gross Profit','Operating Expenses','Net Income'];
    const entityTotals = {};
    ENTITIES.forEach((e, i) => { if (results[i] !== null) entityTotals[e] = this._summarizePnlData(results[i]); });

    let html = `<table class="data-table"><thead><tr><th>Category</th>${ENTITIES.map(e=>`<th class="r">${e}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>`;
    cats.forEach(cat => {
      const row = ENTITIES.map((e, i) => results[i] === null ? null : (entityTotals[e]?.[cat] || 0));
      const validVals = row.filter(v => v !== null);
      const total = validVals.reduce((s,v) => s+v, 0);
      html += `<tr><td>${cat}</td>${row.map(v => `<td class="r">${v === null ? '<span style="color:var(--text3)">—</span>' : fmt(v)}</td>`).join('')}<td class="r"><strong>${fmt(total)}</strong></td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  async _renderPnlVsPrior(data, range) {
    const container = document.getElementById('pnlReport');
    container.innerHTML = '<p style="color:var(--text3)">Loading prior year…</p>';

    const shift = d => { const dt = new Date(d); dt.setFullYear(dt.getFullYear()-1); return dt.toISOString().slice(0,10); };
    const priorRange = { from: shift(range.from), to: shift(range.to) };
    const entity = state.pnlEntities && state.pnlEntities.length > 0 ? state.pnlEntities : state.globalEntity;
    const priorData = await this.fetchReportData(entity, priorRange);

    if (!priorData) {
      container.innerHTML = '<div style="padding:16px;color:var(--text3)">Prior year data unavailable for this period.</div>';
      return;
    }

    const curr = this._summarizePnlData(data);
    const prior = this._summarizePnlData(priorData);
    const cats = ['Revenue','COGS','Gross Profit','Operating Expenses','Net Income'];

    let html = '<table class="data-table"><thead><tr><th>Category</th><th class="r">Current</th><th class="r">Prior Yr</th><th class="r">$ Var</th><th class="r">% Var</th></tr></thead><tbody>';
    cats.forEach(cat => {
      const c = curr[cat] || 0, p = prior[cat] || 0, varD = c - p;
      const varP = p !== 0 ? (varD/Math.abs(p)*100).toFixed(1)+'%' : '—';
      const cls = varD >= 0 ? 'g' : 'r';
      html += `<tr><td>${cat}</td><td class="r">${fmt(c)}</td><td class="r">${fmt(p)}</td><td class="r ${cls}">${fmt(varD)}</td><td class="r ${cls}">${varP}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

  async _renderPnlVsBudget(data, range) {
    const container = document.getElementById('pnlReport');
    if (!container) return;
    container.innerHTML = '<div style="padding:24px;color:var(--text3)">Loading comparison…</div>';

    // Compute prior period of same length
    const from  = new Date(range.from);
    const to    = new Date(range.to);
    const days  = Math.round((to - from) / 86400000) + 1;
    const pFrom = new Date(from); pFrom.setDate(pFrom.getDate() - days);
    const pTo   = new Date(from); pTo.setDate(pTo.getDate() - 1);
    const pad   = d => d.toISOString().slice(0,10);
    const priorRange = { from: pad(pFrom), to: pad(pTo) };

    const entity = state.pnlEntities?.length ? state.pnlEntities : state.globalEntity;
    const priorData = await this.fetchReportData(entity, priorRange);

    const curr  = this._summarizePnlData(data);
    const prior = priorData ? this._summarizePnlData(priorData) : {};

    const hasBudget = !!window._plBudget;
    const compLabel = hasBudget ? 'Budget' : 'Prior Period';
    const cats = [
      { label:'Revenue',            key:'Revenue'            },
      { label:'COGS',               key:'COGS'               },
      { label:'Gross Profit',       key:'Gross Profit'       },
      { label:'Operating Expenses', key:'Operating Expenses' },
      { label:'Net Income',         key:'Net Income'         },
    ];
    const bgt = window._plBudget || {};
    const bgtKey = { 'Revenue':'revenue','COGS':'cogs','Gross Profit':'gross_profit','Operating Expenses':'operating_expenses','Net Income':'net_income' };

    let html = `<div style="font-size:12px;color:var(--text3);margin-bottom:12px">Comparing current period vs ${hasBudget ? 'budget' : `prior period (${priorRange.from} – ${priorRange.to})`}</div>`;
    html += `<table class="data-table"><thead><tr><th>Category</th><th class="r">Actual</th><th class="r">${compLabel}</th><th class="r">$ Var</th><th class="r">% Var</th></tr></thead><tbody>`;
    cats.forEach(({ label, key }) => {
      const actual = curr[key] || 0;
      const comp   = hasBudget ? (bgt[bgtKey[key]] ?? null) : (prior[key] ?? null);
      const varD   = comp !== null ? actual - comp : null;
      const varP   = (comp && varD !== null) ? (varD / Math.abs(comp) * 100).toFixed(1) + '%' : '—';
      const cls    = varD !== null ? (varD >= 0 ? 'g' : 'r') : '';
      html += `<tr><td>${label}</td><td class="r">${fmt(actual)}</td><td class="r">${comp !== null ? fmt(comp) : '—'}</td><td class="r ${cls}">${varD !== null ? fmt(varD) : '—'}</td><td class="r ${cls}">${varP}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  },

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

      // Floating bar waterfall: each bar is [bottom, top]
      const wfData = [
        [0, rev],      // Revenue rises 0 → rev
        [gp, rev],     // COGS drops rev → gp
        [gp, gp],      // Gross Profit — zero-height (label bar, invisible)
        [net, gp],     // Op. Expenses drops gp → net
        [0, net],      // Net Income
      ];
      const wfColors = [
        '#3b82f6',
        '#ef4444',
        'rgba(0,0,0,0)',
        '#f59e0b',
        net >= 0 ? '#22c55e' : '#ef4444',
      ];

      if (state.charts.pnlWaterfall) state.charts.pnlWaterfall.destroy();
      state.charts.pnlWaterfall = new Chart(wfEl, {
        type: 'bar',
        data: {
          labels: ['Revenue','COGS','Gross Profit','Op. Expenses','Net Income'],
          datasets: [{ data: wfData, backgroundColor: wfColors, borderRadius: 4 }]
        },
        options: {
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => fmt(ctx.raw[1] - ctx.raw[0]) } }
          },
          scales: { y: { ticks: { callback: v => this.fmtM(v) } } }
        }
      });
    }

    // --- 12-Month Margin Trend Chart ---
    const marginEl = document.getElementById('pnlMarginChart');
    if (marginEl) {
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
          datasets: [{
            label: 'Net Margin %',
            data: marginData,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59,130,246,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 3
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: v => v.toFixed(1)+'%' } } }
        }
      });
    }
  },

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
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: v => this.fmtM(v) } } }
        }
      });
    }

    // --- Budget vs Actual (horizontal bar) ---
    const baEl = document.getElementById('budgetActualChart');
    if (baEl && window._plBudget) {
      const cats = ['revenue','cogs','gross_profit','operating_expenses','net_income'];
      const labels = ['Revenue','COGS','Gross Profit','Op. Expenses','Net Income'];
      const actuals = [summary.Revenue, summary.COGS, summary['Gross Profit'], summary['Operating Expenses'], summary['Net Income']].map(v => Math.abs(v||0));
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
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: true } },
          scales: { x: { ticks: { callback: v => this.fmtM(v) } } }
        }
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
          labels: months.map(m => m.label),
          datasets: [
            { label: 'Gross Margin %',     data: monthData.map(d => calcMargin(d,'gross')),     borderColor:'#22c55e', fill:false, tension:0.3 },
            { label: 'Operating Margin %', data: monthData.map(d => calcMargin(d,'operating')), borderColor:'#3b82f6', fill:false, tension:0.3 },
            { label: 'Net Margin %',       data: monthData.map(d => calcMargin(d,'net')),       borderColor:'#7c3aed', fill:false, tension:0.3 }
          ]
        },
        options: {
          plugins: { legend: { display: true, position: 'top' } },
          scales: { y: { ticks: { callback: v => v.toFixed(1)+'%' } } }
        }
      });
    }
  },

  async setPnlEntity(val) { await this.renderPnl(); },

  togglePnlEntity(code) {
    const idx = state.pnlEntities.indexOf(code);
    if (idx >= 0) state.pnlEntities.splice(idx, 1);
    else state.pnlEntities.push(code);
    // Update pill styles
    document.querySelectorAll('.pnl-entity-pill').forEach(b => b.classList.remove('active'));
    if (state.pnlEntities.length === 0) {
      document.getElementById('pnlPillAll')?.classList.add('active');
    } else {
      state.pnlEntities.forEach(c => document.getElementById('pnlPill' + c)?.classList.add('active'));
    }
    this.renderPnl();
  },

  clearPnlEntities() {
    state.pnlEntities = [];
    document.querySelectorAll('.pnl-entity-pill').forEach(b => b.classList.remove('active'));
    document.getElementById('pnlPillAll')?.classList.add('active');
    this.renderPnl();
  },

  setPnlMode(mode) {
    state.pnlMode = mode;
    document.querySelectorAll('.pl-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    this.navigate('pnl');
  },

  openComparisonUpload() {
    const title = document.getElementById('modalTitle');
    const body  = document.getElementById('modalBody');
    if (!title || !body) return;
    title.textContent = 'Upload Comparison P&L';
    body.innerHTML = `
      <p style="font-size:12px;color:var(--text3);margin-bottom:16px">Upload a prior year P&L CSV/Excel. The file should have an account name column and an amount column.</p>
      <div class="form-group">
        <label>Comparison Label (e.g. "2024 Full Year")</label>
        <input type="text" id="cmpLabel" placeholder="2024 Full Year" style="font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius);width:100%;background:var(--surface)">
      </div>
      <div class="form-group">
        <label>File</label>
        <input type="file" id="cmpFileInput" accept=".csv,.xls,.xlsx" style="font-size:13px" onchange="app._loadComparisonFile(this)">
      </div>
      <div id="cmpMapArea"></div>
      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
      </div>
    `;
    document.getElementById('modalOverlay').classList.add('open');
  },

  _loadComparisonFile(input) {
    const file = input.files[0];
    if (!file) return;
    this.readSpreadsheetFile(file, (headers, rows) => {
      this._cmpImportData = { headers, rows };
      const mapArea = document.getElementById('cmpMapArea');
      if (!mapArea) return;
      const opts = headers.map((h, i) => `<option value="${i}">${h}</option>`).join('');
      mapArea.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div class="form-group" style="margin:0">
            <label>Account Name column</label>
            <select id="cmpNameCol" class="filter-select" style="width:100%"><option value="-1">—</option>${opts}</select>
          </div>
          <div class="form-group" style="margin:0">
            <label>Amount column</label>
            <select id="cmpAmtCol" class="filter-select" style="width:100%"><option value="-1">—</option>${opts}</select>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:12px">${rows.length} rows detected</div>
        <div class="form-actions" style="margin-top:0">
          <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
          <button class="btn-primary" onclick="app.saveComparison()">Save Comparison</button>
        </div>
      `;
      // Auto-detect columns
      headers.forEach((h, i) => {
        const k = h.toLowerCase().replace(/[^a-z]/g,'');
        if (['name','account','description','category'].some(x => k.includes(x))) document.getElementById('cmpNameCol').value = i;
        if (['amount','total','value','balance','sum'].some(x => k.includes(x))) document.getElementById('cmpAmtCol').value = i;
      });
    });
  },

  saveComparison() {
    const label   = document.getElementById('cmpLabel')?.value?.trim() || 'Prior Period';
    const nameCol = parseInt(document.getElementById('cmpNameCol')?.value ?? '-1');
    const amtCol  = parseInt(document.getElementById('cmpAmtCol')?.value ?? '-1');
    if (nameCol < 0 || amtCol < 0) { this.toast('Select account name and amount columns'); return; }
    const { rows } = this._cmpImportData || {};
    if (!rows?.length) { this.toast('No data loaded'); return; }
    const data = {};
    rows.forEach(row => {
      const name = (row[nameCol] || '').replace(/"/g,'').trim();
      const amt  = parseFloat((row[amtCol] || '').replace(/["$,\s]/g,''));
      if (name && !isNaN(amt)) data[_pnlNorm(name)] = amt;
    });
    localStorage.setItem('pnlComparison', JSON.stringify({ label, data }));
    this.toast(`Comparison "${label}" loaded`);
    this.closeModal();
    this.renderPnl();
  },

  clearComparison() {
    localStorage.removeItem('pnlComparison');
    _pnlCmp = null;
    document.getElementById('pnlReport')?.classList.remove('comparing');
    this.renderPnl();
  },

  // ---- BALANCE SHEET ----
  async fetchBalanceSheetData(entity) {
    let query = supabaseClient
      .from('transactions')
      .select('amount, account_id, accounts(id, account_code, account_name, account_type, account_subtype, is_elimination)');
    query = applyEntityFilter(query, entity);
    const { data: txns, error } = await query;
    if (error) { console.error('Balance Sheet error:', error); return null; }
    return txns || [];
  },

  async renderBalance() {
    const entity = state.globalEntity;
    const period = this.getPeriodLabel(state.globalPeriod);
    const assetsCol   = document.getElementById('bsAssetsCol');
    const liabEqCol   = document.getElementById('bsLiabEquityCol');
    if (assetsCol) assetsCol.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';
    if (liabEqCol) liabEqCol.innerHTML = '';

    const [bsTxns, pnlData] = await Promise.all([
      this.fetchBalanceSheetData(entity),
      this.fetchReportData(entity, state.globalPeriodRange)
    ]);
    if (!bsTxns) {
      if (assetsCol) assetsCol.innerHTML = '<div style="padding:32px;color:var(--red)">Failed to load</div>';
      return;
    }

    const groups = this.groupByAccount(bsTxns);
    const byType = (type) => Object.values(groups).filter(g => g.account.account_type === type && !g.account.is_elimination);
    const sumLines = (lines) => lines.reduce((s, g) => s + g.total, 0);
    const renderLines = (lines, isLiab = false) => lines.map(g =>
      pnlLine(`${g.account.account_code} — ${g.account.account_name}`, isLiab ? Math.abs(g.total) : g.total, 2, '', g.account.id)
    ).join('');

    const assetLines  = byType('asset');
    const liabLines   = byType('liability');
    const equityLines = byType('equity');

    const totalAssets = sumLines(assetLines);
    const totalLiab   = Math.abs(sumLines(liabLines));

    let netProfit = 0;
    if (pnlData) {
      const pnlGroups = this.groupByAccount(pnlData.txns);
      const rev = Object.values(pnlGroups).filter(g => g.account.account_type === 'revenue').reduce((s, g) => s + g.total, 0);
      const exp = Object.values(pnlGroups).filter(g => g.account.account_type === 'expense').reduce((s, g) => s + Math.abs(g.total), 0);
      netProfit = rev - exp;
    }

    const totalEquity     = sumLines(equityLines) + netProfit;
    const totalLiabEquity = totalLiab + totalEquity;
    const balanced        = Math.abs(totalAssets - totalLiabEquity) < 1;

    const header = `
      <div class="report-header">
        <h2>Balance Sheet</h2>
        <p>WB Brands LLC — ${entity === 'all' ? 'Consolidated' : entity} · As of ${period}</p>
      </div>`;

    const assetsHTML = `
      ${header}
      ${pnlSection('Assets')}
      ${renderLines(assetLines)}
      ${pnlTotal('Total Assets', totalAssets, 'pos')}
      ${totalAssets === 0 ? `<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">No asset transactions classified yet.</div>` : ''}
    `;

    const liabEqHTML = `
      ${pnlSection('Liabilities')}
      ${renderLines(liabLines, true)}
      ${pnlTotal('Total Liabilities', totalLiab)}
      ${pnlSection('Equity')}
      ${renderLines(equityLines)}
      ${pnlLine('Net profit (current period)', netProfit, 2, netProfit >= 0 ? 'pos' : 'neg')}
      ${pnlTotal('Total Equity', totalEquity, totalEquity >= 0 ? 'pos' : 'neg')}
      ${pnlGrand('Total Liabilities + Equity', totalLiabEquity, 'pos')}
      ${!balanced && (totalAssets > 0 || totalLiab > 0) ? `<div style="color:var(--red);padding:8px;font-size:13px">⚠ Out of balance by ${fmt(Math.abs(totalAssets - totalLiabEquity))}</div>` : ''}
    `;

    if (assetsCol) assetsCol.innerHTML = assetsHTML;
    if (liabEqCol) liabEqCol.innerHTML = liabEqHTML;

    // --- Balance Sheet Ratio Cards ---
    const bsTxnData = { txns: bsTxns };
    const bsData = this._parseBsData(bsTxnData);
    // Override netIncome with the already-computed value
    bsData.netIncome = netProfit;
    const setRatio = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const safeDivide = (a, b) => b !== 0 ? (a/b).toFixed(2) : '—';

    setRatio('bsCurrentRatio', safeDivide(bsData.currentAssets, bsData.currentLiabilities));
    setRatio('bsDebtEquity',   safeDivide(bsData.totalLiabilities, bsData.totalEquity || totalEquity));
    setRatio('bsQuickRatio',   safeDivide(bsData.currentAssets - bsData.inventory, bsData.currentLiabilities));

    // --- Retained Earnings Waterfall ---
    const reEl = document.getElementById('bsReChart');
    if (reEl) {
      const priorRE   = bsData.priorRE || 0;
      const netIncome = netProfit;
      const distrib   = bsData.distributions || 0;
      const currentRE = priorRE + netIncome - distrib;
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
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: v => this.fmtM(v) } } }
        }
      });
    }
  },

  _parseBsData(data) {
    if (!data) return { currentAssets:0, currentLiabilities:0, totalLiabilities:0, totalEquity:0, inventory:0, priorRE:0, netIncome:0, distributions:0 };
    const txns = data.txns || [];
    const sum = type => txns.filter(t=>t.accounts?.account_type===type).reduce((s,t)=>s+Math.abs(t.amount),0);
    return {
      currentAssets:      sum('current asset'),
      currentLiabilities: sum('current liability'),
      totalLiabilities:   sum('current liability') + sum('long-term liability'),
      totalEquity:        sum('equity'),
      inventory:          txns.filter(t=>t.accounts?.account_subtype==='inventory').reduce((s,t)=>s+Math.abs(t.amount),0),
      priorRE:            0,
      netIncome:          sum('revenue') - sum('cogs') - sum('expense'),
      distributions:      txns.filter(t=>t.accounts?.account_subtype==='owner distribution').reduce((s,t)=>s+Math.abs(t.amount),0),
    };
  },

  // ---- JOURNALS ----
  async renderJournals() {
    const el = document.getElementById('page-journals');
    if (!el) return;
    const period = state.globalPeriodRange.from.slice(0,7);
    const periodLabel = this.getPeriodLabel(state.globalPeriod);

    const { data: closedCheck } = await supabaseClient
      .from('closed_periods').select('id, closed_at').eq('period', period).maybeSingle();
    const isClosed = !!closedCheck;

    const { data: journals, error } = await supabaseClient
      .from('journal_entries')
      .select('id, accounting_date, description, entry_type, period, entity_id, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name))')
      .gte('period', state.globalPeriodRange.from.slice(0,7))
      .lte('period', state.globalPeriodRange.to.slice(0,7))
      .order('accounting_date', { ascending: false });
    if (error) console.error('Journal load error:', error);

    const displayRows = [];
    (journals || []).forEach(je => {
      const shortId = 'JE-' + je.id.slice(0,8).toUpperCase();
      (je.ledger_entries || []).forEach(line => {
        displayRows.push({
          jeId:    je.id,      // full UUID for deletion
          id:      shortId,
          date:    je.accounting_date,
          memo:    line.memo || je.description,
          account: line.accounts ? line.accounts.account_code + ' — ' + line.accounts.account_name : '',
          debit:   Number(line.debit_amount)  || 0,
          credit:  Number(line.credit_amount) || 0,
          type:    je.entry_type || 'manual'
        });
      });
    });

    // Count unique journal entries
    const uniqueJEs = [...new Set(displayRows.map(r => r.jeId))].length;

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left">
          <span style="font-size:13px;color:var(--text3)">${uniqueJEs} journal entr${uniqueJEs !== 1 ? 'ies' : 'y'} · ${displayRows.length} lines</span>
          <button id="journalBulkDeleteBtn" class="btn-outline" style="display:none;color:var(--red);border-color:var(--red);font-size:12px;padding:4px 12px;margin-left:8px" onclick="app.bulkDeleteJournals()">Delete Selected</button>
        </div>
        <div class="toolbar-right">
          ${isClosed
            ? `<span style="font-size:12px;font-weight:600;color:var(--green);background:var(--green-soft,#e6f9f0);padding:4px 10px;border-radius:6px;border:1px solid var(--green)">✓ ${periodLabel} Closed</span>`
            : `<button class="btn-primary" onclick="app.openCloseMonth()">Close Month: ${periodLabel}</button>`}
        </div>
      </div>
      ${displayRows.length === 0 ? `
        <div style="padding:64px;text-align:center;color:var(--text3)">
          <p style="font-size:15px;margin-bottom:8px">No journal entries for ${periodLabel}</p>
          <p style="font-size:13px">Journal entries will appear here after closing a month.</p>
        </div>
      ` : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:28px"><input type="checkbox" id="journalSelectAll" title="Select all" onchange="app.onJournalSelectAll(this)"></th>
                <th style="white-space:nowrap">ID</th><th style="white-space:nowrap">Date</th><th>Memo</th><th>Account</th><th style="white-space:nowrap">Debit</th><th style="white-space:nowrap">Credit</th><th>Type</th>
              </tr>
            </thead>
            <tbody>
              ${displayRows.map(r => `
                <tr data-je-id="${r.jeId}">
                  <td style="width:32px;padding:11px 8px"><input type="checkbox" class="journal-check" data-je-id="${r.jeId}" onchange="app.onJournalCheck()"></td>
                  <td style="font-family:var(--mono);font-size:12px;white-space:nowrap">${r.id}</td>
                  <td style="white-space:nowrap">${r.date}</td>
                  <td><div style="width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.memo}</div></td>
                  <td><div style="width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${r.account}</div></td>
                  <td style="white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--red,#dc2626);font-weight:600">${r.debit > 0 ? `(${fmt(r.debit)})` : ''}</td>
                  <td style="white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--green,#059669);font-weight:600">${r.credit > 0 ? fmt(r.credit) : ''}</td>
                  <td style="white-space:nowrap"><span class="badge">${r.type}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  },

  onJournalSelectAll(cb) {
    document.querySelectorAll('.journal-check').forEach(c => c.checked = cb.checked);
    this.onJournalCheck();
  },

  onJournalCheck() {
    const checked = document.querySelectorAll('.journal-check:checked');
    const uniqueJEs = new Set([...checked].map(c => c.dataset.jeId)).size;
    const btn = document.getElementById('journalBulkDeleteBtn');
    if (btn) {
      btn.style.display = uniqueJEs > 0 ? 'inline-block' : 'none';
      btn.textContent = uniqueJEs > 0 ? `Delete ${uniqueJEs} Selected` : 'Delete Selected';
    }
  },

  async bulkDeleteJournals() {
    const checked = [...document.querySelectorAll('.journal-check:checked')];
    const jeIds = [...new Set(checked.map(c => c.dataset.jeId))].filter(Boolean);
    if (!jeIds.length) return;
    if (!confirm(`Delete ${jeIds.length} journal entr${jeIds.length !== 1 ? 'ies' : 'y'} and all their lines? This cannot be undone.`)) return;
    const { error } = await supabaseClient.from('journal_entries').delete().in('id', jeIds);
    if (error) { this.toast('Delete failed — see console'); console.error(error); return; }
    this.showToast(`${jeIds.length} journal entr${jeIds.length !== 1 ? 'ies' : 'y'} deleted`, 'success');
    await this.renderJournals();
  },

  // ---- VENDORS ----
  renderVendors(search = '', type = '') {
    const typeFilter = document.getElementById('vendorTypeFilter')?.value || type;
    const list = DATA.vendors.filter(v => {
      if (typeFilter && v.type !== typeFilter) return false;
      if (search && !v.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const tbody = document.getElementById('vendorBody');
    tbody.innerHTML = list.map(v => `
      <tr>
        <td style="font-weight:500">${v.name}</td>
        <td><span class="badge badge-${v.type === 'cogs' ? 'expense' : v.type === 'shipping' ? 'payroll' : 'transfer'}">${v.type.replace('_',' ')}</span></td>
        <td class="amount">${fmt(v.ytd)}</td>
        <td style="text-align:center">${v.openInvoices}</td>
        <td>${v.overdue ? `<span class="badge badge-overdue">${v.overdue} overdue</span>` : '<span style="color:var(--text3)">—</span>'}</td>
        <td style="font-size:11px;color:var(--text2)">${v.lastPayment}</td>
        <td><span class="badge badge-${v.status === 'overdue' ? 'overdue' : 'confirmed'}">${v.status}</span></td>
      </tr>`).join('');
  },

  filterVendors(search) {
    if (search === undefined) search = document.getElementById('vendorSearch')?.value || '';
    this.renderVendors(search);
  },

  // ---- INVOICES ----
  renderInvoices() {
    const filter = document.getElementById('invoiceStatusFilter')?.value || '';
    const allInvoices = DATA.invoices.filter(i => !filter || i.status === filter);
    const filtered = this._invBucketFilter
      ? allInvoices.filter(inv => this.agingBucket(inv.due).cls === this._invBucketFilter)
      : allInvoices;
    const tbody = document.getElementById('invoiceBody');
    tbody.innerHTML = filtered.map(i => {
      const remaining = i.amount - i.paid;
      const daysOverdue = i.status === 'overdue' ? Math.round((new Date() - new Date(i.due)) / 86400000) : 0;
      const aging = this.agingBucket(i.due);
      const ageCell    = `<td class="r">${aging.days !== undefined && aging.days >= 0 ? aging.days : '—'}</td>`;
      const bucketCell = `<td><span class="aging-chip ${aging.cls}">${aging.label}</span></td>`;
      return `<tr>
        <td style="font-family:var(--mono);font-size:11px">${i.invoiceNum}</td>
        <td style="font-weight:500">${i.vendor}</td>
        <td style="font-size:11px">${i.date}</td>
        <td style="font-size:11px;${i.status === 'overdue' ? 'color:var(--red)' : ''}">${i.due}${daysOverdue > 0 ? ` <span style="font-size:10px">(${daysOverdue}d late)</span>` : ''}</td>
        <td class="amount">${fmt(i.amount)}</td>
        <td class="amount-pos">${i.paid ? fmt(i.paid) : '—'}</td>
        <td class="amount ${remaining > 0 ? 'amount-neg' : ''}">${remaining > 0 ? fmt(remaining) : '—'}</td>
        <td><span class="badge badge-${i.status}">${i.status}</span></td>
        ${ageCell}${bucketCell}
        <td>
          <div style="display:flex;gap:4px">
            ${i.status !== 'paid' ? `<button class="action-btn primary btn-sm" onclick="app.payInvoice('${i.id}')">Pay</button>` : ''}
            <button class="action-btn btn-sm" onclick="app.viewInvoice('${i.id}')">View</button>
          </div>
        </td>
      </tr>`;
    }).join('');
    this._renderInvoiceAgingGrid(allInvoices);
  },

  _renderInvoiceAgingGrid(invoices) {
    const BUCKET_LABELS = ['Current','1-30 Days','31-60 Days','61-90 Days','90+ Days'];
    const BUCKET_CLS    = ['current','low','medium','high','critical'];
    const totals = [0,0,0,0,0];
    const counts = [0,0,0,0,0];
    const clsToIdx = { current:0, low:1, medium:2, high:3, critical:4 };

    invoices.forEach(inv => {
      const aging = this.agingBucket(inv.due);
      const idx = clsToIdx[aging.cls] ?? 0;
      totals[idx] += (inv.amount || 0);
      counts[idx]++;
    });

    const grid = document.getElementById('invAgingGrid');
    if (grid) {
      grid.innerHTML = BUCKET_LABELS.map((label, i) => `
        <div class="aging-cell ${this._invBucketFilter===BUCKET_CLS[i]?'active':''}" onclick="app.filterInvoicesByBucket('${BUCKET_CLS[i]}')">
          <div class="aging-cell-label">${label}</div>
          <div class="aging-cell-val">${fmt(totals[i])}</div>
          <div class="aging-cell-count">${counts[i]} invoice${counts[i]!==1?'s':''}</div>
        </div>`).join('');
    }
  },

  filterInvoicesByBucket(bucket) {
    this._invBucketFilter = this._invBucketFilter === bucket ? null : bucket;
    this.navigate('invoices');
  },

  async payInvoice(id) {
    const inv = DATA.invoices.find(i => i.id === id);
    if (inv) {
      inv.paid = inv.amount;
      inv.status = 'paid';
      this.renderInvoices();
      this.toast(`Invoice ${inv.invoiceNum} marked as paid`);

      if (supabaseClient) {
        const { error } = await supabaseClient
          .from('invoices')
          .update({ amount_paid: inv.amount, status: 'paid' })
          .eq('id', id);
        if (error) console.error('Pay invoice error:', error);
      }
    }
  },

  // ---- COA ----
  renderCOA(search = '') {
    const typeFilter = document.getElementById('coaTypeFilter')?.value || '';
    const list = DATA.coa.filter(a => {
      if (typeFilter && a.type !== typeFilter) return false;
      if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.code.includes(search)) return false;
      return true;
    });
    const tbody = document.getElementById('coaBody');
    tbody.innerHTML = list.map(a => `
      <tr>
        <td style="font-family:var(--mono);font-size:11px">${a.code}</td>
        <td style="font-weight:500">${a.name}</td>
        <td><span class="badge badge-${a.type === 'asset' ? 'asset' : a.type === 'liability' ? 'liability' : a.type === 'equity' ? 'equity' : a.type === 'revenue' ? 'revenue' : 'expense2'}">${a.type}</span></td>
        <td style="font-size:11px;color:var(--text2)">${a.subtype || '—'}</td>
        <td style="font-size:11px">${a.line || '—'}</td>
        <td class="amount ${a.balance < 0 ? 'amount-neg' : ''}">${fmt(Math.abs(a.balance))}</td>
        <td>${a.elimination ? '<span class="badge badge-transfer">Yes</span>' : '<span style="color:var(--text3);font-size:11px">—</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn-outline" style="font-size:11px;padding:3px 10px" onclick="app.openEditAccount('${a.id}')">Edit</button>
          <button class="btn-outline" style="font-size:11px;padding:3px 10px;color:var(--red);border-color:var(--red);margin-left:4px" onclick="app.deleteAccount('${a.id}','${a.name.replace(/'/g,"\\'")}')">Delete</button>
        </td>
      </tr>`).join('');
  },

  // ---- CASH FORECAST ----
  renderCashForecast() {
    this.renderForecast();
  },

  renderForecast() {
    const entity = state.globalEntity;
    const key    = `forecast_${entity}_2026`;
    const stored = JSON.parse(localStorage.getItem(key) || '{}');
    const el     = document.getElementById('forecastEntity');
    if (el) el.textContent = entity === 'all' ? 'All Entities' : entity;

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const ROWS   = ['Revenue','COGS','Gross Profit','Operating Expenses','Net Income'];

    const tbl = document.getElementById('forecastTable');
    if (!tbl) return;

    const getVal = (row, mo) => stored[`${row}_${mo}`] ?? '';

    let html = `<thead><tr><th>Category</th>${MONTHS.map(m=>`<th class="r">${m}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>`;

    ROWS.forEach(row => {
      const vals = MONTHS.map((_,mo) => {
        const v = parseFloat(getVal(row, mo)) || 0;
        return { v };
      });
      const total = vals.reduce((s,{v})=>s+v,0);
      html += `<tr><td>${row}</td>${vals.map(({v},mo) =>
        `<td class="r fc-cell" data-row="${row}" data-mo="${mo}"
            contenteditable="true"
            onblur="app.saveForecastCell('${row}',${mo},this.textContent)">${v || ''}</td>`
      ).join('')}<td class="r"><strong>${fmt(total)}</strong></td></tr>`;
    });

    html += `</tbody><tfoot><tr><td>Total</td>${MONTHS.map((_,mo) => {
      const colTotal = ROWS.reduce((s,row)=>s+(parseFloat(getVal(row,mo))||0),0);
      return `<td class="r">${fmt(colTotal)}</td>`;
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
    this.renderForecast();
  },

  resetForecast() {
    if (!confirm('Reset all forecast data for this entity?')) return;
    localStorage.removeItem(`forecast_${state.globalEntity}_2026`);
    this.renderForecast();
  },

  exportForecast() {
    this.showToast('Export coming soon', 'success');
  },

  // ---- CASH BALANCES ----
  async renderCashBalances() {
    const el = document.getElementById('page-cash-balances');
    if (!el) return;

    el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

    const CB_ENTITIES = ['WB Brands','Koolers Promo','WB Promo','Band Promo','Lanyard Promo','SP Brands','One Ops'];
    const CB_INPUT_COLS = [
      { key:'tfb',       label:'TFB',                   section:1 },
      { key:'hunt',      label:'Huntington Bank',        section:1 },
      { key:'vend_pay',  label:'Vendor Payments',         section:1 },
      { key:'cc',        label:'CC',                     section:1 },
      { key:'int_xfer',  label:'Int Transfer',           section:1 },
      { key:'google',    label:'Google/Agencies',        section:1 },
      { key:'hunt_bal',  label:'Huntington Bal',         section:1 },
      { key:'cc_pay',    label:'Credit Card',            section:2, payable:true },
      { key:'vend_pmts', label:'Vendor Payments',        section:2, payable:true },
      { key:'goog_pend', label:'Google Pending',         section:2, payable:true },
      { key:'fedex',     label:'Fedex, ASI, Agencies',   section:2, payable:true },
      { key:'stripe_pp', label:'Stripe + Paypal +3 days',section:2 },
    ];

    // Load from Supabase
    const { data: rows, error } = await supabaseClient
      .from('cash_balances').select('entity, col_key, value, updated_at');
    if (error) { this.showToast('Failed to load cash balances', 'error'); console.error(error); }

    const saved = {};
    let latestUpdated = null;
    (rows || []).forEach(r => {
      saved[r.entity + '_' + r.col_key] = r.value;
      if (!latestUpdated || r.updated_at > latestUpdated) latestUpdated = r.updated_at;
    });

    const fmtCell = (val, isPayable, isComputed) => {
      if (val === null || val === undefined || val === '') return '';
      const num = Number(val);
      if (isNaN(num) || num === 0) return '';
      const color = isPayable ? 'var(--red,#dc2626)' : (num < 0 ? 'var(--red,#dc2626)' : 'var(--green,#059669)');
      return `<span style="color:${color};font-weight:600">${isPayable ? '(' : ''}${fmt(Math.abs(num))}${isPayable ? ')' : ''}</span>`;
    };

    const getVal = (entity, key) => {
      const raw = saved[entity + '_' + key];
      return raw !== undefined && raw !== '' ? Number(raw) || 0 : 0;
    };

    const buildRow = (entityLabel, isTotal) => {
      const cells = CB_INPUT_COLS.map(col => {
        const val = getVal(entityLabel, col.key);
        const numVal = col.payable ? -Math.abs(val) : val;
        if (isTotal) {
          // For total row, sum all entities
          const sum = CB_ENTITIES.reduce((s, ent) => {
            const v = getVal(ent, col.key);
            return s + (col.payable ? -Math.abs(v) : v);
          }, 0);
          return `<td class="cb-computed" style="text-align:right">${fmtCell(sum, col.payable, true)}</td>`;
        }
        return `<td style="text-align:right;${col.payable?'background:rgba(220,38,38,0.03)':''}">
          <span contenteditable="true" class="cb-cell"
            data-entity="${entityLabel.replace(/"/g,'&quot;')}"
            data-key="${col.key}"
            data-payable="${col.payable ? '1' : '0'}"
            onblur="app.saveCashBalance(this)"
            style="display:block;min-width:70px;outline:none;cursor:text"
          >${val !== 0 ? val : ''}</span>
        </td>`;
      });

      // Compute Cash Total, Total Payables, Cash Bal
      const cashTotal = isTotal
        ? CB_ENTITIES.reduce((s,e) => s + CB_INPUT_COLS.filter(c=>c.section===1).reduce((ss,c)=>ss+getVal(e,c.key),0), 0)
        : CB_INPUT_COLS.filter(c=>c.section===1).reduce((s,c)=>s+getVal(entityLabel,c.key),0);
      const totalPayables = isTotal
        ? CB_ENTITIES.reduce((s,e) => s + CB_INPUT_COLS.filter(c=>c.payable).reduce((ss,c)=>ss+Math.abs(getVal(e,c.key)),0), 0)
        : CB_INPUT_COLS.filter(c=>c.payable).reduce((s,c)=>s+Math.abs(getVal(entityLabel,c.key)),0);
      const stripeVal = isTotal
        ? CB_ENTITIES.reduce((s,e)=>s+getVal(e,'stripe_pp'),0)
        : getVal(entityLabel,'stripe_pp');
      const cashBal = cashTotal - totalPayables + stripeVal;

      const cashTotalCell = `<td class="cb-computed" style="text-align:right;background:rgba(37,99,235,0.06)">${fmtCell(cashTotal,false,true)}</td>`;
      const totalPayCell  = `<td class="cb-computed" style="text-align:right;background:rgba(220,38,38,0.06)">${fmtCell(totalPayables,true,true)}</td>`;
      const cashBalColor  = cashBal >= 0 ? 'var(--green,#059669)' : 'var(--red,#dc2626)';
      const cashBalCell   = `<td class="cb-computed" style="text-align:right;background:rgba(37,99,235,0.06)"><span style="color:${cashBalColor};font-weight:700">${cashBal !== 0 ? (cashBal<0?'('+fmt(Math.abs(cashBal))+')':fmt(cashBal)) : ''}</span></td>`;

      // Insert computed cols at right positions: after hunt_bal (idx 6), after fedex (idx 10), at end
      const allCells = [...cells];
      // After index 6 (hunt_bal) → Cash Total
      allCells.splice(7, 0, cashTotalCell);
      // After index 10+1=11 (fedex, now shifted by 1) → Total Payables
      allCells.splice(13, 0, totalPayCell);
      // At end → Cash Bal
      allCells.push(cashBalCell);

      const rowClass = isTotal ? 'style="background:var(--surface2);font-weight:700"' : '';
      return `<tr ${rowClass}>
        <td style="font-weight:600;white-space:nowrap;padding:6px 10px">${isTotal ? 'Total' : entityLabel}</td>
        ${allCells.join('')}
      </tr>`;
    };

    // Build header
    const allHeaders = [
      ...CB_INPUT_COLS.slice(0,7).map(c=>`<th style="text-align:right;white-space:nowrap;font-size:11px">${c.label}</th>`),
      `<th style="text-align:right;white-space:nowrap;font-size:11px;background:rgba(37,99,235,0.08)">Cash Total</th>`,
      ...CB_INPUT_COLS.slice(7,11).map(c=>`<th style="text-align:right;white-space:nowrap;font-size:11px;background:rgba(220,38,38,0.05)">${c.label}</th>`),
      `<th style="text-align:right;white-space:nowrap;font-size:11px;background:rgba(220,38,38,0.08)">Total Payables</th>`,
      `<th style="text-align:right;white-space:nowrap;font-size:11px">${CB_INPUT_COLS[11].label}</th>`,
      `<th style="text-align:right;white-space:nowrap;font-size:11px;background:rgba(37,99,235,0.08)">Cash Bal (exp) (3days)</th>`,
    ].join('');

    const today = new Date().toLocaleDateString('en-US', { month:'numeric', day:'numeric', year:'2-digit' });

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h2 class="page-title">Cash Balances</h2>
          <p class="page-subtitle" style="font-size:12px;color:var(--text3)">Manually updated · as of <strong>${latestUpdated ? new Date(latestUpdated).toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'2-digit'}) : today}</strong></p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary" style="font-size:12px" onclick="app.openCashBalanceSyncModal()">↓ Sync from Google Sheet</button>
          <button class="btn-outline" style="font-size:12px" onclick="app.exportCashBalances()">Export CSV</button>
        </div>
      </div>
      <div class="card" style="overflow-x:auto">
        <table class="data-table cash-bal-table" style="font-size:12px;min-width:1200px">
          <thead>
            <tr>
              <th style="white-space:nowrap">Entity</th>
              ${allHeaders}
            </tr>
          </thead>
          <tbody>
            ${CB_ENTITIES.map(e => buildRow(e, false)).join('')}
            ${buildRow('Total', true)}
          </tbody>
        </table>
      </div>
    `;
  },

  async saveCashBalance(el) {
    const entity = el.dataset.entity;
    const key    = el.dataset.key;
    const raw    = el.textContent.trim().replace(/[$,()]/g, '');
    const value  = raw === '' ? null : Number(raw) || 0;

    if (value === null || value === 0) {
      await supabaseClient.from('cash_balances')
        .delete().eq('entity', entity).eq('col_key', key);
    } else {
      const { error } = await supabaseClient.from('cash_balances')
        .upsert({ entity, col_key: key, value, updated_at: new Date().toISOString() },
                 { onConflict: 'entity,col_key' });
      if (error) { this.showToast('Failed to save', 'error'); console.error(error); return; }
    }
    // Re-render to update computed columns
    this.renderCashBalances();
  },

  exportCashBalances() {
    this.showToast('CSV export coming soon', 'info');
  },

  openCashBalanceSyncModal() {
    const saved = localStorage.getItem('wb_cb_sheet_url') || '';
    const overlay = document.getElementById('modalOverlay');
    const body = document.getElementById('modalBody');
    if (!overlay || !body) return;
    body.innerHTML = `
      <div style="font-size:15px;font-weight:600;margin-bottom:4px">↓ Sync from Google Sheet</div>
      <p style="font-size:12px;color:var(--text3);margin-bottom:16px">Sheet must be publicly shared (Anyone with link → Viewer). First column = Entity name, remaining columns = balance fields by header.</p>
      <div class="form-group">
        <label style="font-size:12px">Google Sheet URL</label>
        <input id="cbSheetUrl" type="text" placeholder="https://docs.google.com/spreadsheets/d/…"
          style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)"
          value="${saved}">
      </div>
      <div class="form-group" style="margin-top:10px">
        <label style="font-size:12px">Tab / Sheet Name <span style="color:var(--text3)">(optional — leave blank for first tab)</span></label>
        <input id="cbSheetTab" type="text" placeholder="e.g. Cash Balances"
          style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)">
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
        <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="app.syncCashBalancesFromSheet()">Sync</button>
      </div>
    `;
    overlay.classList.add('open');
  },

  async syncCashBalancesFromSheet() {
    const urlInput = document.getElementById('cbSheetUrl')?.value.trim();
    const tabInput = document.getElementById('cbSheetTab')?.value.trim();
    if (!urlInput) { this.showToast('Paste a Google Sheet URL', 'error'); return; }

    // Extract sheet ID from URL
    const match = urlInput.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) { this.showToast('Invalid Google Sheet URL', 'error'); return; }
    const sheetId = match[1];
    localStorage.setItem('wb_cb_sheet_url', urlInput);

    const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json${tabInput ? '&sheet=' + encodeURIComponent(tabInput) : ''}`;

    this.showToast('Fetching sheet…', 'info');
    let raw;
    try {
      const res = await fetch(gvizUrl);
      raw = await res.text();
    } catch(e) {
      this.showToast('Could not fetch sheet — check URL and sharing settings', 'error');
      return;
    }

    // Strip JSONP wrapper: response is /*O_o*/\ngoogle.visualization.Query.setResponse({...});
    const json = raw.replace(/^[^{]*/, '').replace(/[);\s]+$/, '');
    let gdata;
    try { gdata = JSON.parse(json); } catch(e) {
      console.error('Sheet parse error:', e, '\nRaw (first 200):', raw.slice(0, 200));
      this.showToast('Could not parse sheet — ensure it is publicly shared (Anyone with link → Viewer)', 'error'); return;
    }

    const gvizCols = (gdata.table?.cols || []).map(c => (c.label || '').trim().toLowerCase());
    const allRows = gdata.table?.rows || [];
    if (!allRows.length) {
      this.showToast('Sheet appears empty', 'error'); return;
    }

    // Column definitions we're looking for
    const CB_INPUT_COLS = [
      { key:'tfb',       labels:['tfb','texas first','tfb bal'] },
      { key:'hunt',      labels:['huntington bank','huntington','hunt bank'] },
      { key:'vend_pay',  labels:['vendor payments','vendor pay','vend pay'] },
      { key:'cc',        labels:['cc','credit card bal'] },
      { key:'int_xfer',  labels:['int transfer','internal transfer','int xfer'] },
      { key:'google',    labels:['google/agencies','google agencies','google'] },
      { key:'hunt_bal',  labels:['huntington bal','huntington balance','hunt bal'] },
      { key:'cc_pay',    labels:['credit card','cc pay'] },
      { key:'vend_pmts', labels:['vendor payments','vendor pmts'] },
      { key:'goog_pend', labels:['google pending','goog pend'] },
      { key:'fedex',     labels:['fedex, asi, agencies','fedex','fedex asi'] },
      { key:'stripe_pp', labels:['stripe + paypal +3 days','stripe','stripe + paypal','stripe/paypal'] },
    ];

    // Helper: try to match a set of column labels against CB_INPUT_COLS
    const matchCols = (labels) => {
      const map = {};
      labels.forEach((label, i) => {
        const lower = label.toLowerCase().trim();
        if (!lower) return;
        for (const def of CB_INPUT_COLS) {
          if (def.labels.some(l => lower.includes(l))) { map[i] = def.key; break; }
        }
      });
      return map;
    };

    // Detect entity column (the column that has entity names like "WB Brands", "Band Promo", etc.)
    const ENTITY_KEYWORDS = ['wb brands','koolers','wb promo','band promo','lanyard','sp brands','one ops','one operations'];
    const findEntityCol = (rows) => {
      for (let col = 0; col < 5; col++) {
        let matches = 0;
        for (let r = 0; r < Math.min(rows.length, 15); r++) {
          const val = (rows[r]?.c?.[col]?.v || '').toString().toLowerCase();
          if (ENTITY_KEYWORDS.some(k => val.includes(k))) matches++;
        }
        if (matches >= 3) return col;
      }
      return 0; // default to first column
    };

    // 1. Find entity column from data
    const entityCol = findEntityCol(allRows);

    // 2. Try gviz header labels first
    let colMap = matchCols(gvizCols);
    let dataRows = allRows;

    // 3. If gviz headers didn't match, scan rows to find the header row
    if (Object.keys(colMap).length === 0) {
      console.log('Cash Balances: gviz headers did not match, scanning rows for header…');
      for (let r = 0; r < Math.min(allRows.length, 15); r++) {
        const cells = allRows[r].c || [];
        const rowLabels = cells.map(c => (c?.v || c?.f || '').toString().trim());
        const testMap = matchCols(rowLabels);
        if (Object.keys(testMap).length >= 2) {
          console.log(`Cash Balances: found header row at index ${r}:`, rowLabels);
          colMap = testMap;
          dataRows = allRows.slice(r + 1);
          break;
        }
      }
    }

    // 4. If fewer than 4 columns matched (sparse/merged headers), fill remaining with position-based mapping
    if (Object.keys(colMap).length < 4) {
      console.log('Cash Balances: sparse headers — using position-based column mapping');
      // Scan first entity row to find which columns have numeric data
      const firstEntityRow = allRows.find(r => {
        const val = (r?.c?.[entityCol]?.v || '').toString().toLowerCase();
        return ENTITY_KEYWORDS.some(k => val.includes(k));
      });
      if (firstEntityRow) {
        // Map columns relative to entity column
        const e = entityCol;
        const posMap = [
          [e+1, 'tfb'], [e+2, 'hunt'], [e+3, 'vend_pay'], [e+4, 'cc'],
          [e+5, 'int_xfer'], [e+6, 'google'], [e+7, 'hunt_bal'],
          [e+8, 'cc_pay'], [e+9, 'vend_pmts'], [e+10, 'goog_pend'],
          [e+11, 'fedex'], [e+12, 'stripe_pp'],
        ];
        // Only include positions that have data in at least one entity row
        const entityRows = allRows.filter(r => {
          const val = (r?.c?.[entityCol]?.v || '').toString().toLowerCase();
          return ENTITY_KEYWORDS.some(k => val.includes(k));
        });
        const assignedKeys = new Set(Object.values(colMap));
        for (const [col, key] of posMap) {
          if (colMap[col] || assignedKeys.has(key)) continue; // don't overwrite header matches
          const hasData = entityRows.some(r => {
            const v = r?.c?.[col]?.v;
            return v !== null && v !== undefined && v !== '' && Number(v) !== 0;
          });
          if (hasData) { colMap[col] = key; assignedKeys.add(key); }
        }
        // Remove the header row and any rows before the first entity
        const firstEntityIdx = allRows.indexOf(firstEntityRow);
        dataRows = allRows.slice(firstEntityIdx);
        console.log('Cash Balances: position-based colMap:', colMap);
      }
    }

    if (Object.keys(colMap).length === 0) {
      console.warn('Cash Balances: no matching columns. gviz cols:', gvizCols);
      this.showToast('Could not find matching column data — check sheet layout and console', 'error');
      return;
    }

    // Accept both display names AND short codes (case-insensitive)
    const CB_ENTITY_MAP = {
      'wb brands': 'WB Brands', 'wbp': 'WB Brands', 'wb promo': 'WB Brands',
      'koolers promo': 'Koolers Promo', 'kp': 'Koolers Promo', 'kooler': 'Koolers Promo',
      'band promo': 'Band Promo', 'bp': 'Band Promo',
      'lanyard promo': 'Lanyard Promo', 'lp': 'Lanyard Promo', 'lanyard': 'Lanyard Promo',
      'sp brands': 'SP Brands', 'sp1': 'SP Brands', 'sp': 'SP Brands',
      'one ops': 'One Ops', 'oneops': 'One Ops', 'one operations': 'One Ops',
    };
    const upserts = [];
    dataRows.forEach(row => {
      const cells = row.c || [];
      const entityRaw = (cells[entityCol]?.v || '').toString().trim();
      const entityMatch = CB_ENTITY_MAP[entityRaw.toLowerCase()] ||
        Object.values(CB_ENTITY_MAP).find(v => v.toLowerCase() === entityRaw.toLowerCase());
      if (!entityMatch) return;
      Object.entries(colMap).forEach(([i, key]) => {
        const val = cells[Number(i)]?.v;
        const num = val !== null && val !== undefined && val !== '' ? Number(val) : null;
        if (num !== null && !isNaN(num) && num !== 0) {
          upserts.push({ entity: entityMatch, col_key: key, value: num, updated_at: new Date().toISOString() });
        }
      });
    });

    if (!upserts.length) {
      this.showToast('No matching data found — check entity names and column headers', 'error'); return;
    }

    // Deduplicate: keep last value for each entity+col_key pair
    const deduped = {};
    upserts.forEach(u => { deduped[u.entity + '|' + u.col_key] = u; });
    const uniqueUpserts = Object.values(deduped);

    console.log('Cash Balances: final colMap:', JSON.stringify(colMap));
    console.log('Cash Balances: sample upsert data:', uniqueUpserts.slice(0, 10));

    // Clear old data first so stale values don't persist
    await supabaseClient.from('cash_balances').delete().gte('updated_at', '2000-01-01');

    const { error } = await supabaseClient.from('cash_balances')
      .upsert(uniqueUpserts, { onConflict: 'entity,col_key' });
    if (error) { this.showToast('Failed to save to Supabase', 'error'); console.error(error); return; }

    this.closeModal();
    this.showToast(`Synced ${uniqueUpserts.length} values from sheet (cleared old data)`, 'success');
    this.renderCashBalances();
  },

  // ---- RATIOS & KPIs ----
  async renderRatios() {
    const el = document.getElementById('ratiosContent');
    if (!el) return;
    el.innerHTML = '<div style="padding:32px;color:var(--text3)">Calculating…</div>';
    const fmt = n => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pct = n => (n * 100).toFixed(1) + '%';
    const ratio = (n, decimals=2) => isFinite(n) ? n.toFixed(decimals) + 'x' : '—';

    const entity = state.globalEntity;

    // Fetch P&L data
    let rev=0, cogs=0, adSpend=0, otherExp=0;
    if (supabaseClient) {
      let q = supabaseClient.from('transactions')
        .select('amount, accounts(account_type, account_subtype)')
        .gte('acc_date', state.globalPeriodRange.from).lte('acc_date', state.globalPeriodRange.to);
      q = applyEntityFilter(q, entity);
      const { data: txns } = await q;
      for (const t of (txns||[])) {
        const amt = Number(t.amount);
        if (t.accounts?.account_type === 'revenue') rev += amt;
        else if (t.accounts?.account_type === 'expense') {
          if (t.accounts?.account_subtype === 'cogs') cogs += Math.abs(amt);
          else if (t.accounts?.account_subtype === 'advertising') adSpend += Math.abs(amt);
          else otherExp += Math.abs(amt);
        }
      }
    }
    const grossProfit  = rev - cogs;
    const ebitda       = grossProfit - adSpend - otherExp;
    const netProfit    = ebitda; // simplified (no D&A/interest in current model)
    const gpMargin     = rev > 0 ? grossProfit / rev : 0;
    const ebitdaMargin = rev > 0 ? ebitda / rev : 0;
    const npMargin     = rev > 0 ? netProfit / rev : 0;

    // Fetch balance sheet data
    let curAssets=0, curLiab=0, totalAssets=0, totalLiab=0, equity=0, cash=0, ar=0, ap=0;
    if (supabaseClient) {
      let q2 = supabaseClient.from('transactions').select('amount, accounts(account_type, account_subtype)');
      q2 = applyEntityFilter(q2, entity);
      const { data: bsTxns } = await q2;
      for (const t of (bsTxns||[])) {
        const amt = Number(t.amount);
        const typ = t.accounts?.account_type;
        const sub = t.accounts?.account_subtype;
        if (typ === 'asset') {
          totalAssets += amt;
          if (sub === 'cash' || sub === 'bank') { curAssets += amt; cash += amt; }
          else if (sub === 'receivable') { curAssets += amt; ar += amt; }
          else if (sub === 'current') curAssets += amt;
        } else if (typ === 'liability') {
          totalLiab += Math.abs(amt);
          if (sub === 'payable' || sub === 'current') { curLiab += Math.abs(amt); ap += Math.abs(amt); }
        } else if (typ === 'equity') {
          equity += amt;
        }
      }
    }
    // AR from invoices
    if (ar === 0) ar = DATA.invoices.filter(i=>i.status!=='paid').reduce((s,i)=>s+(Number(i.amount)-Number(i.amount_paid||0)),0);

    const currentRatio = curLiab > 0 ? curAssets / curLiab : 0;
    const quickRatio   = curLiab > 0 ? (cash + ar) / curLiab : 0;
    const cashRatio    = curLiab > 0 ? cash / curLiab : 0;
    const roa          = totalAssets > 0 ? netProfit / totalAssets : 0;
    const roe          = equity > 0 ? netProfit / equity : 0;
    const dso          = rev > 0 ? (ar / (rev / 30)) : 0;
    const dpo          = cogs > 0 ? (ap / (cogs / 30)) : 0;
    const workingCap   = curAssets - curLiab;
    const debtEquity   = equity > 0 ? totalLiab / equity : 0;

    const card = (label, value, benchmark, color, statusKey) => {
      const statusMap = { ok: 'ok', warn: 'warn', bad: 'bad' };
      return `<div class="ratio-card ${color}">
        <div class="ratio-label">${label}</div>
        <div class="ratio-value">${value}</div>
        <div class="ratio-benchmark">Benchmark: ${benchmark}</div>
        <span class="ratio-status ${statusMap[statusKey] || 'warn'}">${statusKey === 'ok' ? '✓ Good' : statusKey === 'bad' ? '✗ Low' : '~ Watch'}</span>
      </div>`;
    };

    el.innerHTML = `
      <div class="ratio-section">
        <div class="ratio-section-title">Liquidity</div>
        <div class="ratio-grid">
          ${card('Current Ratio', ratio(currentRatio), '>1.5x', 'blue', currentRatio>=1.5?'ok':currentRatio>=1?'warn':'bad')}
          ${card('Quick Ratio', ratio(quickRatio), '>1.0x', 'blue', quickRatio>=1?'ok':quickRatio>=0.7?'warn':'bad')}
          ${card('Cash Ratio', ratio(cashRatio), '>0.2x', 'blue', cashRatio>=0.2?'ok':cashRatio>=0.1?'warn':'bad')}
          ${card('Working Capital', fmt(workingCap), 'Positive', 'blue', workingCap>0?'ok':'bad')}
        </div>
      </div>
      <div class="ratio-section">
        <div class="ratio-section-title">Profitability</div>
        <div class="ratio-grid">
          ${card('Gross Margin', pct(gpMargin), '40–60%', 'green', gpMargin>=0.4?'ok':gpMargin>=0.25?'warn':'bad')}
          ${card('EBITDA Margin', pct(ebitdaMargin), '10–20%', 'green', ebitdaMargin>=0.1?'ok':ebitdaMargin>=0.05?'warn':'bad')}
          ${card('Net Profit Margin', pct(npMargin), '5–15%', 'green', npMargin>=0.05?'ok':npMargin>=0?'warn':'bad')}
          ${card('ROA', pct(roa), '>5%', 'green', roa>=0.05?'ok':roa>=0.02?'warn':'bad')}
          ${card('ROE', pct(roe), '>15%', 'green', roe>=0.15?'ok':roe>=0.05?'warn':'bad')}
        </div>
      </div>
      <div class="ratio-section">
        <div class="ratio-section-title">Efficiency</div>
        <div class="ratio-grid">
          ${card('DSO', dso.toFixed(0)+' days', '<45 days', 'amber', dso<=45?'ok':dso<=60?'warn':'bad')}
          ${card('DPO', dpo.toFixed(0)+' days', '<60 days', 'amber', dpo<=60?'ok':dpo<=90?'warn':'bad')}
          ${card('Debt / Equity', ratio(debtEquity), '<2.0x', 'amber', debtEquity<=2?'ok':debtEquity<=3?'warn':'bad')}
        </div>
      </div>
      ${rev === 0 ? '<p style="padding:24px;text-align:center;color:var(--text3);font-size:13px">No classified transactions for this period — ratios will calculate once transactions are posted.</p>' : ''}
    `;
    if (supabaseClient) {
      const data = await this.fetchReportData(entity, state.globalPeriodRange);
      if (data) await this.renderRatioCharts(data, state.globalPeriodRange);
    }
  },

  // ---- CFO NOTES ----
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

  // ---- SALES METRICS ----
  renderSalesMetrics() {
    const el = document.getElementById('salesContent');
    if (!el) return;

    // Seed P&L data (15 months)
    if (!window._plData) {
      window._plData = {
        months:     ['Jan-25','Feb-25','Mar-25','Apr-25','May-25','Jun-25','Jul-25','Aug-25','Sep-25','Oct-25','Nov-25','Dec-25','Jan-26','Feb-26','Mar-26'],
        net_sales:  [2555281,2593914,2801234,2734512,2912345,2845678,2623451,2534789,2798432,2901234,3012345,3123456,2823714,2718200,2723714],
        cogs:       [1341523,1335866,1456641,1421946,1514019,1479752,1364194,1318090,1455185,1508642,1566419,1624197,1168140,1052790,1168140],
        ads:        [853719, 855992, 924407,902590, 961074, 939474, 866139, 836284, 923540, 957408,1034006,1030741,631966, 636160, 0      ],
        overhead:   [385524, 276482, 379547,340120, 358234,341263, 322876,304215, 345328,358243, 371824, 384328,319523, 290340, 0      ],
        gross_profit:[1213759,1258048,1344593,1312566,1398326,1365926,1259257,1216699,1343247,1392592,1445926,1499259,1655574,1665410,1555574],
        net_profit: [-25484, 125574, 40599,  69856, 79019, 84913, 70242, 76200, 74379, 76941, 39096, 84190,704085, 738910,1555574],
        gp_margin:  [47.5,   48.5,   48.0,   48.0,  48.0,  48.0,  48.0,  48.0,  48.0,  48.0,  48.0,  48.0,  57.1,   61.3,   57.1   ],
        np_margin:  [-1.0,   4.84,   1.45,   2.55,  2.71,  2.98,  2.68,  3.01,  2.66,  2.65,  1.30,  2.69, 24.93,  27.18,  57.1   ],
        dividends:  [225000, 300000, 0,      225000,300000,0,     225000,300000,0,     225000,300000,0,     225000, 300000, 0      ],
      };
    }
    const pd = window._plData;
    const latestIdx = pd.months.length - 1;
    const latestSales = pd.net_sales[latestIdx];
    const prevSales   = pd.net_sales[latestIdx - 1] || 0;
    const latestCogs  = pd.cogs[latestIdx];
    const latestAds   = pd.ads[latestIdx];
    const cogsP = latestSales > 0 ? (latestCogs / latestSales * 100).toFixed(1) : '0.0';
    const varPct  = prevSales > 0 ? ((latestSales - prevSales) / prevSales * 100).toFixed(1) : null;
    const target  = 3000000;
    const vsTarget = latestSales - target;

    const fmtK = n => '$' + (n/1000).toFixed(0) + 'K';

    const salesCfg = this._getSyncConfig();
    const hasSalesSheet = !!(salesCfg.plSheetId);
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700;color:var(--text)">Sales Metrics
          ${hasSalesSheet ? `<span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:8px">Sheet connected</span>` : ''}
        </div>
        <button class="btn-outline" style="font-size:12px;padding:4px 12px" onclick="app.syncSalesSheet()">🔄 Sync from Google Sheet</button>
      </div>
      <div class="sales-kpi-row">
        <div class="sales-kpi" style="border-top-color:#2563eb">
          <div class="sales-kpi-label">Latest Month Net Sales</div>
          <div class="sales-kpi-value">${app.fmtM(latestSales)}</div>
          <div class="sales-kpi-sub">${pd.months[latestIdx]}</div>
        </div>
        <div class="sales-kpi" style="border-top-color:${vsTarget>=0?'var(--green)':'var(--red)'}">
          <div class="sales-kpi-label">vs Target ($3M)</div>
          <div class="sales-kpi-value" style="color:${vsTarget>=0?'var(--green)':'var(--red)'}">${vsTarget>=0?'+':''}${fmtK(vsTarget)}</div>
          <div class="sales-kpi-sub">${varPct !== null ? (varPct >= 0 ? '+' : '') + varPct + '% vs prior month' : ''}</div>
        </div>
        <div class="sales-kpi" style="border-top-color:#d97706">
          <div class="sales-kpi-label">COGS %</div>
          <div class="sales-kpi-value">${cogsP}%</div>
          <div class="sales-kpi-sub">of net sales</div>
        </div>
        <div class="sales-kpi" style="border-top-color:#7c3aed">
          <div class="sales-kpi-label">Ads Cost</div>
          <div class="sales-kpi-value">${fmtK(latestAds)}</div>
          <div class="sales-kpi-sub">${latestSales > 0 ? (latestAds/latestSales*100).toFixed(1) + '% of sales' : ''}</div>
        </div>
        <div class="sales-kpi" style="border-top-color:#0891b2">
          <div class="sales-kpi-label">Gross Margin</div>
          <div class="sales-kpi-value">${pd.gp_margin[latestIdx].toFixed(1)}%</div>
          <div class="sales-kpi-sub">of net sales</div>
        </div>
      </div>
      <div class="sales-charts-grid">
        <div class="card">
          <div class="card-header"><span class="card-title">Monthly Net Sales (15 months)</span></div>
          <div class="chart-wrap" style="height:240px"><canvas id="salesMonthlyChart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">GP & NP Margins</span></div>
          <div class="chart-wrap" style="height:240px"><canvas id="salesMarginChart"></canvas></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Net Profit Trend</span></div>
        <div class="chart-wrap" style="height:200px"><canvas id="salesProfitChart"></canvas></div>
      </div>
    `;

    // Monthly bar + target line
    setTimeout(() => {
      const mc = document.getElementById('salesMonthlyChart');
      if (mc) {
        if (window._salesMonthlyChart) window._salesMonthlyChart.destroy();
        window._salesMonthlyChart = new Chart(mc.getContext('2d'), {
          type: 'bar',
          data: {
            labels: pd.months,
            datasets: [
              { label: 'Net Sales', data: pd.net_sales.map(v => Math.round(v/1000)), backgroundColor: '#2563eb', borderRadius: 4 },
              { label: 'COGS',      data: pd.cogs.map(v => Math.round(v/1000)),      backgroundColor: '#f87171', borderRadius: 4 },
              { label: 'Target', data: pd.months.map(() => Math.round(target/1000)), type: 'line', borderColor: '#d97706', borderDash: [6,4], backgroundColor: 'transparent', pointRadius: 0, borderWidth: 2 },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } }, scales: { y: { ticks: { callback: v => '$' + v + 'K' } } } }
        });
      }
      const mgc = document.getElementById('salesMarginChart');
      if (mgc) {
        if (window._salesMarginChart) window._salesMarginChart.destroy();
        window._salesMarginChart = new Chart(mgc.getContext('2d'), {
          type: 'line',
          data: {
            labels: pd.months,
            datasets: [
              { label: 'GP Margin %', data: pd.gp_margin, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.08)', fill: true, tension: 0.3 },
              { label: 'NP Margin %', data: pd.np_margin, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', fill: true, tension: 0.3 },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } }, scales: { y: { ticks: { callback: v => v + '%' } } } }
        });
      }
      const pc = document.getElementById('salesProfitChart');
      if (pc) {
        if (window._salesProfitChart) window._salesProfitChart.destroy();
        window._salesProfitChart = new Chart(pc.getContext('2d'), {
          type: 'bar',
          data: {
            labels: pd.months,
            datasets: [
              { label: 'Net Profit', data: pd.net_profit.map(v => Math.round(v/1000)), backgroundColor: pd.net_profit.map(v => v>=0?'#16a34a':'#f87171'), borderRadius: 4 },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '$' + v + 'K' } } } }
        });
      }
    }, 50);
  },

  async renderSales() {
    // Live banner — current month revenue
    const now = new Date();
    const thisMonthFrom = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const today = now.toISOString().slice(0,10);
    const { data: revTxns } = await supabaseClient.from('transactions').select('amount, accounts(account_type)')
      .gte('acc_date', thisMonthFrom).lte('acc_date', today);
    const monthRev = (revTxns || []).filter(t=>t.accounts?.account_type==='revenue').reduce((s,t)=>s+t.amount,0);
    const setEl = (id, val) => { const e=document.getElementById(id); if(e) e.textContent=val; };
    setEl('salesLiveVal', fmt(monthRev));
    setEl('salesLiveSub', `${this.getPeriodLabel(state.globalPeriod)} · ${state.globalEntity==='all'?'All Entities':state.globalEntity}`);

    // Weekly chart — last 7 days
    const days = [];
    for (let i=6; i>=0; i--) { const d=new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().slice(0,10)); }
    const { data: weekTxns } = await supabaseClient.from('transactions').select('amount, acc_date, accounts(account_type)')
      .gte('acc_date', days[0]).lte('acc_date', days[6]);
    const dayTotals = days.map(day => (weekTxns||[]).filter(t=>t.acc_date===day&&t.accounts?.account_type==='revenue').reduce((s,t)=>s+t.amount,0));

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
    const priorRev  = (priorTxns||[]).filter(t=>t.accounts?.account_type==='revenue').reduce((s,t)=>s+t.amount,0);
    const budget    = (window._plBudget?.revenue || 0) / 12;
    const varBgt    = budget > 0 ? ((monthRev-budget)/budget*100).toFixed(1) : '—';

    const tbl = document.getElementById('salesMonthlyTable');
    if (tbl) {
      tbl.innerHTML = `<thead><tr><th>Metric</th><th class="r">Current</th><th class="r">Prior Mo.</th><th class="r">Budget</th><th class="r">vs Budget</th></tr></thead>
      <tbody>
        <tr><td>Revenue</td><td class="r">${fmt(monthRev)}</td><td class="r">${fmt(priorRev)}</td><td class="r">${fmt(budget)}</td><td class="r ${varBgt !== '—' && parseFloat(varBgt)>=0 ? 'g' : 'r'}">${varBgt !== '—' ? varBgt+'%' : '—'}</td></tr>
      </tbody>`;
    }
  },

  // ---- PRODUCT MIX ----
  renderProductMix() {
    const el = document.getElementById('productmixContent');
    if (!el) return;

    // Seed product mix data
    if (!window._productMix) {
      window._productMix = {
        updatedAt: 'Seed data',
        categories: [
          { name: 'Lanyards',       revenue: 1302095, cogs: 468754, ads: 227866, platform: 'Shopify', channel: 'Direct' },
          { name: 'Wristbands',     revenue: 816239,  cogs: 293846, ads: 142792, platform: 'Amazon',  channel: 'Marketplace' },
          { name: 'Can Coolers',    revenue: 435854,  cogs: 156907, ads:  76274, platform: 'Shopify', channel: 'Direct' },
          { name: 'Tumblers',       revenue: 109536,  cogs:  39433, ads:  19169, platform: 'Etsy',    channel: 'Marketplace' },
          { name: 'Custom Apparel', revenue:  59990,  cogs:  21596, ads:  10498, platform: 'Shopify', channel: 'Wholesale' },
        ],
      };
    }
    if (window._productMix && !window._productMix.adSpend) {
      window._productMix.adSpend   = { meta: 18400, google: 12700, tiktok: 6200 };
      window._productMix.channels  = { online: 0.52, retail: 0.28, wholesale: 0.14, other: 0.06 };
      window._productMix.adRevenue = { meta: 112000, google: 88000, tiktok: 34000 };
    }
    const mx = window._productMix;
    const totalRev   = mx.categories.reduce((s,c) => s+c.revenue, 0);
    const totalCogs  = mx.categories.reduce((s,c) => s+c.cogs, 0);
    const totalAds   = mx.categories.reduce((s,c) => s+c.ads, 0);
    const totalGP    = totalRev - totalCogs - totalAds;
    const pct  = (n,d) => d > 0 ? (n/d*100).toFixed(1)+'%' : '—';

    const colors = ['#2563eb','#16a34a','#d97706','#7c3aed','#0891b2'];

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <span style="font-size:11px;color:var(--text3)">Source: ${mx.updatedAt}</span>
        <button class="btn-outline" style="font-size:12px;border-color:var(--purple);color:var(--purple)" onclick="app._refreshProductMix()">🔄 Refresh</button>
      </div>
      <div class="sales-kpi-row">
        <div class="sales-kpi" style="border-top-color:#2563eb"><div class="sales-kpi-label">MTD Revenue</div><div class="sales-kpi-value">${app.fmtM(totalRev)}</div></div>
        <div class="sales-kpi" style="border-top-color:#d97706"><div class="sales-kpi-label">Avg COGS %</div><div class="sales-kpi-value">${pct(totalCogs,totalRev)}</div></div>
        <div class="sales-kpi" style="border-top-color:#7c3aed"><div class="sales-kpi-label">Avg Ads %</div><div class="sales-kpi-value">${pct(totalAds,totalRev)}</div></div>
        <div class="sales-kpi" style="border-top-color:#16a34a"><div class="sales-kpi-label">Gross Margin $</div><div class="sales-kpi-value">${app.fmtM(totalGP)}</div></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><span class="card-title">Category Breakdown</span></div>
        <table class="data-table">
          <thead><tr><th>Category</th><th class="amount">Revenue</th><th class="amount">COGS %</th><th class="amount">Ads %</th><th class="amount">Gross Margin %</th><th class="amount">% of Total</th></tr></thead>
          <tbody>
            ${mx.categories.map((c,i) => {
              const gm = c.revenue > 0 ? ((c.revenue-c.cogs-c.ads)/c.revenue*100).toFixed(1) : '0.0';
              const share = totalRev > 0 ? (c.revenue/totalRev*100).toFixed(1) : '0.0';
              return `<tr>
                <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colors[i]};margin-right:6px"></span>${c.name}</td>
                <td class="amount">${app.fmtM(c.revenue)}</td>
                <td class="amount">${pct(c.cogs,c.revenue)}</td>
                <td class="amount">${pct(c.ads,c.revenue)}</td>
                <td class="amount" style="color:${parseFloat(gm)>=30?'var(--green)':'var(--amber)'}">${gm}%</td>
                <td class="amount">${share}%</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card"><div class="card-header"><span class="card-title">Revenue Mix</span></div><div class="chart-wrap" style="height:220px"><canvas id="pmDonutChart"></canvas></div></div>
        <div class="card"><div class="card-header"><span class="card-title">Revenue by Category</span></div><div class="chart-wrap" style="height:220px"><canvas id="pmBarChart"></canvas></div></div>
      </div>
    `;

    setTimeout(() => {
      const dc = document.getElementById('pmDonutChart');
      if (dc) {
        if (window._pmDonut) window._pmDonut.destroy();
        window._pmDonut = new Chart(dc.getContext('2d'), {
          type: 'doughnut',
          data: { labels: mx.categories.map(c=>c.name), datasets: [{ data: mx.categories.map(c=>Math.round(c.revenue/1000)), backgroundColor: colors, borderWidth: 0 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 10 } } }, cutout: '62%' },
        });
      }
      const bc = document.getElementById('pmBarChart');
      if (bc) {
        if (window._pmBar) window._pmBar.destroy();
        window._pmBar = new Chart(bc.getContext('2d'), {
          type: 'bar',
          data: { labels: mx.categories.map(c=>c.name), datasets: [{ label: 'Revenue ($K)', data: mx.categories.map(c=>Math.round(c.revenue/1000)), backgroundColor: colors, borderRadius: 4 }] },
          options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => '$'+v+'K' } } } },
        });
      }
    }, 50);

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
  },

  async _refreshProductMix() {
    const el = document.getElementById('productmixContent');
    const btn = el?.querySelector('button');
    if (btn) { btn.textContent = '⟳ Loading…'; btn.disabled = true; }

    const range = state.globalPeriodRange;
    let q = supabaseClient
      .from('transactions')
      .select('amount, entity, accounts(account_code, account_name, account_type, account_subtype)')
      .gte('acc_date', range.from)
      .lte('acc_date', range.to);
    const entity = state.globalEntity;
    if (entity !== 'all') q = q.eq('entity', entity);

    const { data: txns, error } = await q;
    if (error || !txns?.length) {
      this.showToast('No transaction data for this period', 'error');
      if (btn) { btn.textContent = '🔄 Refresh'; btn.disabled = false; }
      return;
    }

    // Group revenue and COGS by entity
    const entityMap = {};
    txns.forEach(t => {
      const code = t.entity || 'Other';
      if (!entityMap[code]) entityMap[code] = { revenue: 0, cogs: 0, ads: 0 };
      const type    = t.accounts?.account_type;
      const subtype = t.accounts?.account_subtype;
      const amt = Math.abs(Number(t.amount));
      if (type === 'revenue')                  entityMap[code].revenue += amt;
      if (subtype === 'cogs')                  entityMap[code].cogs    += amt;
      if (subtype === 'advertising')           entityMap[code].ads     += amt;
    });

    const categories = Object.entries(entityMap)
      .filter(([,v]) => v.revenue > 0)
      .sort((a,b) => b[1].revenue - a[1].revenue)
      .map(([name, v]) => ({ name, ...v, platform: 'Supabase', channel: 'Live' }));

    if (!categories.length) {
      this.showToast('No revenue data found for this period', 'error');
      if (btn) { btn.textContent = '🔄 Refresh'; btn.disabled = false; }
      return;
    }

    window._productMix = {
      updatedAt: `Live · ${this.getPeriodLabel(state.globalPeriod)}`,
      categories,
      adSpend:   { meta: 0, google: 0, tiktok: 0 },
      channels:  { online: 0, retail: 0, wholesale: 0, other: 0 },
      adRevenue: { meta: 0, google: 0, tiktok: 0 },
    };

    this.renderProductMix();
    this.showToast('Product mix refreshed from live data', 'success');
  },

  // ---- GOOGLE SHEETS SYNC ----
  async gvizFetch(sheetId, sheetName) {
    const cfg = this._getSyncConfig();
    const encoded = encodeURIComponent(sheetName);
    // Try GAS proxy first if configured
    if (cfg.gasProxy) {
      try {
        const proxyUrl = `${cfg.gasProxy}?action=gviz&id=${sheetId}&sheet=${encoded}`;
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const text = await res.text();
          return this._parseGvizResponse(text);
        }
      } catch { /* fall through to direct */ }
    }
    // Direct gviz (works in some browsers, blocked by CORS in file:// protocol)
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?sheet=${encoded}&tqx=out:json`;
    const res = await fetch(url);
    const text = await res.text();
    return this._parseGvizResponse(text);
  },

  _parseGvizResponse(text) {
    // gviz returns: /*O_o*/ google.visualization.Query.setResponse({...})
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
    if (!match) throw new Error('Invalid gviz response');
    const json = JSON.parse(match[1]);
    const rows = json?.table?.rows || [];
    return rows.map(row => (row.c || []).map(cell => cell?.v ?? null));
  },

  _getSyncConfig() {
    try { return JSON.parse(localStorage.getItem('wbSyncConfig') || '{}'); }
    catch { return {}; }
  },

  async parsePLSheet(rows) {
    if (!rows.length) return;
    // Row 0 = headers, find month columns
    const headers = rows[0] || [];
    const monthCols = [];
    const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    headers.forEach((h, i) => {
      if (i === 0) return;
      const s = String(h || '').toLowerCase();
      if (monthNames.some(m => s.includes(m)) || /\d{4}/.test(s)) monthCols.push({ col: i, label: String(h) });
    });
    if (!monthCols.length) return;

    const find = (keyword) => rows.findIndex(r => String(r[0]||'').toLowerCase().includes(keyword));
    const getRow = (keyword) => {
      const idx = find(keyword);
      return idx >= 0 ? rows[idx] : null;
    };

    const extract = (row) => monthCols.map(mc => Number(String(row?.[mc.col] || 0).replace(/[^0-9.-]/g,'')) || 0);

    const salesRow  = getRow('total income') || getRow('net sales') || getRow('total revenue');
    const cogsRow   = getRow('total cogs')   || getRow('cost of goods');
    const adsRow    = getRow('advertising')  || getRow('ads');
    const ohRow     = getRow('overhead')     || getRow('sg&a');
    const gpRow     = getRow('gross profit');
    const npRow     = getRow('net income')   || getRow('net profit');

    if (!salesRow) return; // can't parse

    window._plData = {
      months:      monthCols.map(m => m.label),
      net_sales:   extract(salesRow),
      cogs:        extract(cogsRow),
      ads:         extract(adsRow),
      overhead:    extract(ohRow),
      gross_profit:extract(gpRow),
      net_profit:  extract(npRow),
      gp_margin:   [],
      np_margin:   [],
      dividends:   new Array(monthCols.length).fill(0),
    };
    const pd = window._plData;
    pd.gp_margin = pd.net_sales.map((s,i) => s > 0 ? pd.gross_profit[i]/s*100 : 0);
    pd.np_margin = pd.net_sales.map((s,i) => s > 0 ? pd.net_profit[i]/s*100 : 0);
  },

  async refreshAllSheets() {
    const cfg = this._getSyncConfig();
    const btn = document.getElementById('syncSheetsBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing…'; }

    let done = 0;
    const total = Object.keys(cfg).filter(k => k.endsWith('Id')).length;
    const check = () => { done++; if (done >= total && btn) { btn.disabled = false; btn.textContent = '🔄 Sync Sheets'; this.toast('Sheets synced'); } };

    try {
      if (cfg.plSheetId) {
        const rows = await this.gvizFetch(cfg.plSheetId, cfg.plSheetName || 'Sheet1');
        await this.parsePLSheet(rows);
        if (state.currentPage === 'sales') this.renderSales();
        check();
      }
    } catch (e) { console.warn('PL sheet sync failed', e); check(); }

    if (done === 0) { if (btn) { btn.disabled = false; btn.textContent = '🔄 Sync Sheets'; } this.toast('Configure sheet IDs in Bank Connections settings'); }
  },

  async syncSalesSheet() {
    const cfg = this._getSyncConfig();
    if (!cfg.plSheetId) {
      const id  = prompt('Enter Google Sheet ID (found in the sheet URL between /d/ and /edit)');
      if (!id) return;
      const tab = prompt('Enter the tab/sheet name (e.g. Sheet1, P&L)') || 'Sheet1';
      const newCfg = { ...cfg, plSheetId: id.trim(), plSheetName: tab.trim() };
      localStorage.setItem('wbSyncConfig', JSON.stringify(newCfg));
    }
    const btn = document.querySelector('button[onclick="app.syncSalesSheet()"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing…'; }
    try {
      const updatedCfg = this._getSyncConfig();
      const rows = await this.gvizFetch(updatedCfg.plSheetId, updatedCfg.plSheetName || 'Sheet1');
      await this.parsePLSheet(rows);
      this.renderSalesMetrics();
      this.showToast('Sales data synced from Google Sheet', 'success');
    } catch(e) {
      this.showToast('Sheet sync failed — check Sheet ID and that the sheet is shared publicly', 'error');
      console.error('syncSalesSheet error:', e);
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Sync from Google Sheet'; }
    }
  },

  // ---- BANKS ----
  renderBanks() {
    const grid = document.getElementById('banksGrid');
    if (!grid) return;
    const cfg = this._getSyncConfig();
    grid.innerHTML = `
      <div style="grid-column:1/-1">
        <div class="card" style="margin-bottom:16px">
          <div class="card-header"><span class="card-title">Google Sheets Sync Settings</span></div>
          <p style="font-size:12px;color:var(--text2);margin-bottom:16px">Connect your Google Sheets to enable live P&L, sales, and cash balance sync. Requires a Google Apps Script (GAS) proxy URL for CORS bypass.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div class="form-group">
              <label>GAS Proxy URL</label>
              <input type="text" id="syncGasProxy" class="filter-input" style="width:100%" placeholder="https://script.google.com/macros/s/…/exec" value="${cfg.gasProxy||''}"/>
            </div>
            <div class="form-group">
              <label>P&L Sheet ID</label>
              <input type="text" id="syncPlId" class="filter-input" style="width:100%" placeholder="Google Sheet ID" value="${cfg.plSheetId||''}"/>
            </div>
            <div class="form-group">
              <label>P&L Tab Name</label>
              <input type="text" id="syncPlSheet" class="filter-input" style="width:100%" placeholder="e.g. Sheet1" value="${cfg.plSheetName||'Sheet1'}"/>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn-primary" onclick="app.saveSyncConfig()">Save Settings</button>
            <button class="btn-outline" id="syncSheetsBtn" onclick="app.refreshAllSheets()">🔄 Sync Sheets Now</button>
          </div>
        </div>
        <div style="padding:32px;text-align:center;color:var(--text3)">
          <div style="font-size:32px;margin-bottom:16px">🏦</div>
          <p style="font-size:15px;font-weight:600;margin-bottom:8px;color:var(--text2)">Direct Bank Connections — Coming Soon</p>
          <p style="font-size:13px">Real-time bank feeds will be available in a future update.<br>Use CSV import in the Inbox to load transactions in the meantime.</p>
        </div>
      </div>
    `;
  },

  saveSyncConfig() {
    const cfg = {
      gasProxy:    document.getElementById('syncGasProxy')?.value?.trim() || '',
      plSheetId:   document.getElementById('syncPlId')?.value?.trim()     || '',
      plSheetName: document.getElementById('syncPlSheet')?.value?.trim()  || 'Sheet1',
    };
    localStorage.setItem('wbSyncConfig', JSON.stringify(cfg));
    this.toast('Sync settings saved');
  },

  // ---- RECONCILE ----
  async renderReconcile() {
    const reconStats = document.getElementById('reconStats');
    if (reconStats) reconStats.innerHTML = '';

    // --- Fetch existing reconciliation matches ---
    const entity = state.globalEntity;
    const range  = state.globalPeriodRange;

    let matchQ = supabaseClient.from('reconciliation_matches').select('id, statement_txn_id, book_txn_id, match_status, amount');
    if (entity !== 'all') matchQ = matchQ.eq('entity', entity);
    const { data: matches } = await matchQ;
    const matchList = matches || [];

    const counts = { matched:0, unmatched:0, pending:0, disputed:0 };
    matchList.forEach(m => { if (counts[m.match_status] !== undefined) counts[m.match_status]++; });

    const setCard = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
    setCard('reconMatched',   counts.matched);
    setCard('reconUnmatched', counts.unmatched);
    setCard('reconPending',   counts.pending);
    setCard('reconDisputed',  counts.disputed);

    const bankMatchMap = {};
    matchList.forEach(m => { bankMatchMap[m.statement_txn_id] = m; });

    // --- Fetch bank (raw) and book transactions for the current period ---
    const bankBody = document.getElementById('bankBody');
    const bookBody = document.getElementById('bookBody');

    let bankQ = supabaseClient.from('raw_transactions').select('id, acc_date, description, amount, entity')
      .gte('acc_date', range.from).lte('acc_date', range.to);
    if (entity !== 'all') bankQ = bankQ.eq('entity', entity);
    const { data: bankTxns } = await bankQ;

    let bookQ = supabaseClient.from('transactions').select('id, acc_date, description, amount, entity')
      .gte('acc_date', range.from).lte('acc_date', range.to);
    if (entity !== 'all') bookQ = bookQ.eq('entity', entity);
    const { data: bookTxns } = await bookQ;

    const matchedBookIds = new Set(matchList.filter(m => m.match_status === 'matched').map(m => m.book_txn_id));

    if (bankBody) {
      if (!bankTxns || bankTxns.length === 0) {
        bankBody.innerHTML = `<tr><td colspan="4" style="padding:48px;text-align:center;color:var(--text3);font-size:13px">No bank transactions for this period.</td></tr>`;
      } else {
        bankBody.innerHTML = bankTxns.map(bank => {
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
          return `<tr><td>${bank.acc_date||'—'}</td><td>${bank.description||'—'}</td><td class="r">${fmt(bank.amount)}</td><td>${matchCell}</td></tr>`;
        }).join('');
      }
    }

    if (bookBody) {
      if (!bookTxns || bookTxns.length === 0) {
        bookBody.innerHTML = `<tr><td colspan="4" style="padding:48px;text-align:center;color:var(--text3);font-size:13px">No book transactions for this period.</td></tr>`;
      } else {
        bookBody.innerHTML = bookTxns.map(book => {
          const isMatched = matchedBookIds.has(book.id);
          const matchCell = isMatched ? `<span style="color:var(--green)">✓ Matched</span>` : '—';
          return `<tr><td>${book.acc_date||'—'}</td><td>${book.description||'—'}</td><td class="r">${fmt(book.amount)}</td><td>${matchCell}</td></tr>`;
        }).join('');
      }
    }
  },

  async autoMatch() {
    const entity = state.globalEntity;
    const range  = state.globalPeriodRange;

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
        used.add(candidates[0].id);
        inserts.push({ statement_txn_id: String(bank.id), book_txn_id: candidates[0].id, entity: bank.entity || entity, amount: bank.amount, match_status: 'matched', matched_at: new Date().toISOString() });
      } else if (candidates.length > 1) {
        inserts.push({ statement_txn_id: String(bank.id), book_txn_id: null, entity: bank.entity || entity, amount: bank.amount, match_status: 'pending' });
      }
    });

    if (inserts.length) {
      const { error } = await supabaseClient.from('reconciliation_matches').upsert(inserts, { onConflict: 'statement_txn_id' });
      if (error) { this.showToast('Auto-match error: ' + error.message, 'error'); return; }
    }

    this.showToast(`Auto-matched ${inserts.filter(i=>i.match_status==='matched').length} transactions`, 'success');
    await this.renderReconcile();
  },

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

  // ---- CASH FLOW ----
  async renderCashflow() {
    const data = await this.fetchReportData(state.globalEntity, state.globalPeriodRange);
    if (!data) return;

    const txns = data.txns || [];

    // Categorize by account_type. Adjust type strings if your actual Supabase data differs.
    const INVESTING_TYPES = new Set(['fixed asset','long-term asset','equipment']);
    const FINANCING_TYPES = new Set(['long-term liability','notes payable','equity','owner distribution']);

    const investing = txns.filter(t => INVESTING_TYPES.has(t.accounts?.account_type?.toLowerCase()));
    const financing = txns.filter(t => FINANCING_TYPES.has(t.accounts?.account_type?.toLowerCase()));
    const operating = txns.filter(t => !INVESTING_TYPES.has(t.accounts?.account_type?.toLowerCase()) && !FINANCING_TYPES.has(t.accounts?.account_type?.toLowerCase()));

    const colorAmt = (n) => {
      const color = n >= 0 ? 'var(--green)' : 'var(--red)';
      const display = n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n);
      return `<span style="color:${color};font-weight:500">${display}</span>`;
    };

    const renderSection = (bodyId, totalId, items) => {
      const body  = document.getElementById(bodyId);
      const total = document.getElementById(totalId);
      if (!body || !total) return 0;
      const sum = items.reduce((s, t) => s + (t.amount || 0), 0);
      body.innerHTML = items.map(t =>
        `<tr><td>${t.accounts?.account_name || t.description || '—'}</td><td class="r">${colorAmt(t.amount || 0)}</td></tr>`
      ).join('') || '<tr><td colspan="2" style="color:var(--text3)">No activity</td></tr>';
      total.innerHTML = colorAmt(sum);
      return sum;
    };

    const netOp  = renderSection('cfOperatingBody',  'cfOperatingTotal',  operating);
    const netInv = renderSection('cfInvestingBody',  'cfInvestingTotal',  investing);
    const netFin = renderSection('cfFinancingBody',  'cfFinancingTotal',  financing);

    const netChange = netOp + netInv + netFin;
    const priorBank = (window._bankAccounts || []).reduce((s, a) => s + a.balance, 0);
    const ending    = priorBank + netChange;

    const setElColor = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = colorAmt(val); };
    setElColor('cfNetChange',     netChange);
    setElColor('cfEndingBalance', ending);
  },

  // ---- MODALS ----
  openModal(type, data = {}) {
    if (type === 'newRawTxn') { this.openModal_newRawTxn(); return; }
    const overlay = document.getElementById('modalOverlay');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');
    overlay.classList.add('open');

    if (type === 'addTransaction' || type === 'editTransaction') {
      title.textContent = type === 'addTransaction' ? 'Add Transaction' : 'Edit Transaction';
      body.innerHTML = `
        <div class="form-row">
          <div class="form-group">
            <label>Transaction date</label>
            <input type="date" id="fTxnDate" value="${data.txnDate || today()}"/>
          </div>
          <div class="form-group">
            <label>Accounting date <span style="color:var(--accent)">✏</span></label>
            <input type="date" id="fAccDate" value="${data.accDate || today()}"/>
            <div class="date-note">Override to adjust reporting period</div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Entity</label>
            <select id="fEntity">
              <option ${data.entity==='LP'?'selected':''}>LP</option>
              <option ${data.entity==='KP'?'selected':''}>KP</option>
              <option ${data.entity==='BP'?'selected':''}>BP</option>
              <option ${data.entity==='WBP'?'selected':''}>WBP</option>
              <option ${data.entity==='ONEOPS'?'selected':''}>ONEOPS</option>
              <option ${data.entity==='WB'?'selected':''}>WB (consolidated)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Type</label>
            <select id="fType">
              <option ${data.type==='income'?'selected':''}>income</option>
              <option ${data.type==='expense'?'selected':''}>expense</option>
              <option ${data.type==='transfer'?'selected':''}>transfer</option>
              <option ${data.type==='payroll'?'selected':''}>payroll</option>
              <option ${data.type==='cogs'?'selected':''}>cogs</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <input type="text" id="fDesc" value="${data.desc || ''}" placeholder="Description…"/>
        </div>
        <div class="form-group">
          <label>Vendor</label>
          <input type="text" id="fVendor" value="${data.vendor || ''}" placeholder="Vendor name (optional)"/>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Amount ($)</label>
            <input type="number" id="fAmount" value="${Math.abs(data.amount || '')}" placeholder="0.00"/>
          </div>
          <div class="form-group">
            <label>Category</label>
            <select id="fCategory">
              <option ${data.category?.includes('Stripe')?'selected':''}>Gross Revenue — Stripe</option>
              <option ${data.category?.includes('PayPal')?'selected':''}>Gross Revenue — PayPal</option>
              <option ${data.category?.includes('Wire')?'selected':''}>Gross Revenue — Wire/Check</option>
              <option ${data.category?.includes('COGS')?'selected':''}>Cost of Goods Sold</option>
              <option ${data.category?.includes('Shipping')?'selected':''}>Shipping Costs</option>
              <option ${data.category?.includes('Google')?'selected':''}>Google Ads</option>
              <option ${data.category?.includes('Meta')?'selected':''}>Meta Ads</option>
              <option ${data.category?.includes('Wages')?'selected':''}>Wages — W2</option>
              <option ${data.category?.includes('Contractor')?'selected':''}>Contractor — 1099</option>
              <option ${data.category?.includes('Stripe fee')?'selected':''}>Stripe Fees</option>
              <option>Rent Expense</option>
              <option>Bank Fees</option>
              <option>Unclassified</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Source</label>
          <select id="fSource">
            <option>stripe</option><option>paypal</option><option>bank</option><option>manual</option><option>csv</option>
          </select>
        </div>
        <div class="form-actions">
          <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
          <button class="btn-primary" onclick="app.saveTransaction()">Save transaction</button>
        </div>`;
    }

    if (type === 'addJournal') {
      title.textContent = 'Manual Journal Entry';
      body.innerHTML = `
        <div class="form-row">
          <div class="form-group">
            <label>Accounting date <span style="color:var(--accent)">✏</span></label>
            <input type="date" id="fJeDate" value="${today()}"/>
            <div class="date-note">This date controls P&L period</div>
          </div>
          <div class="form-group">
            <label>Entity</label>
            <select id="fJeEntity">
              <option>WB (consolidated)</option><option>LP</option><option>KP</option><option>BP</option><option>WBP</option><option>ONEOPS</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Memo</label>
          <input type="text" id="fJeMemo" placeholder="Journal entry description…"/>
        </div>
        <div style="background:var(--surface2);border-radius:var(--radius);padding:12px;margin-bottom:12px">
          <div style="font-size:11px;font-weight:600;color:var(--text3);margin-bottom:8px">JOURNAL LINES</div>
          <div class="form-row" style="margin-bottom:8px">
            <input class="filter-input" id="fJeAcc1" placeholder="Account code or name" style="flex:1"/>
            <input class="filter-input" id="fJeDebit1" placeholder="Debit $" type="number" style="width:100px"/>
            <input class="filter-input" id="fJeCredit1" placeholder="Credit $" type="number" style="width:100px"/>
          </div>
          <div class="form-row">
            <input class="filter-input" id="fJeAcc2" placeholder="Account code or name" style="flex:1"/>
            <input class="filter-input" id="fJeDebit2" placeholder="Debit $" type="number" style="width:100px"/>
            <input class="filter-input" id="fJeCredit2" placeholder="Credit $" type="number" style="width:100px"/>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:8px">Debits must equal credits</div>
        </div>
        <div class="form-group">
          <label>Entry type</label>
          <select id="fJeType"><option>manual</option><option>accrual</option><option>elimination</option><option>distribution</option></select>
        </div>
        <div class="form-actions">
          <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
          <button class="btn-primary" onclick="app.saveJournal()">Post journal</button>
        </div>`;
    }

    if (type === 'addVendor') {
      title.textContent = 'Add Vendor';
      body.innerHTML = `
        <div class="form-group">
          <label>Vendor name</label>
          <input type="text" id="fVendorName" placeholder="e.g. Promo Direct Inc."/>
        </div>
        <div class="form-group">
          <label>Vendor type</label>
          <select id="fVendorType">
            <option>cogs</option><option>shipping</option><option>ad_agency</option><option>software</option><option>utility</option><option>payroll</option>
          </select>
        </div>
        <div class="form-group">
          <label>Default category</label>
          <select id="fVendorCategory">
            <option>Cost of Goods Sold</option><option>Shipping Costs</option><option>Google Ads</option><option>Meta Ads</option><option>Rent Expense</option><option>Utilities</option>
          </select>
        </div>
        <div class="form-actions">
          <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
          <button class="btn-primary" onclick="app.saveVendor()">Save vendor</button>
        </div>`;
    }

    if (type === 'addApItem') {
      title.textContent = 'Add AP Item';
      const vendorOpts = DATA.vendors.length
        ? DATA.vendors.map(v=>`<option>${v.name}</option>`).join('')
        : '<option value="">No vendors yet — add one first</option>';
      const entityCodes = ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS','SP1'];
      body.innerHTML = `
        <div class="form-group">
          <label>Vendor</label>
          <select id="fApVendor">${vendorOpts}</select>
        </div>
        <div class="form-group">
          <label>Entity</label>
          <select id="fApEntity">${entityCodes.map(e=>`<option>${e}</option>`).join('')}</select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Invoice date</label>
            <input type="date" id="fApInvDate" value="${new Date().toISOString().slice(0,10)}"/>
          </div>
          <div class="form-group">
            <label>Due date</label>
            <input type="date" id="fApDueDate"/>
          </div>
        </div>
        <div class="form-group">
          <label>Amount ($)</label>
          <input type="number" id="fApAmount" step="0.01" min="0" placeholder="0.00"/>
        </div>
        <div class="form-group">
          <label>Description / memo</label>
          <input type="text" id="fApMemo" placeholder="Optional note"/>
        </div>
        <div class="form-actions">
          <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
          <button class="btn-primary" onclick="app.saveApItem()">Save AP Item</button>
        </div>`;
    }

    if (type === 'addInvoice') {
      title.textContent = 'Add Invoice';
      body.innerHTML = `
        <div class="form-group">
          <label>Vendor</label>
          <select id="fInvVendor">${DATA.vendors.map(v=>`<option>${v.name}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label>Invoice number</label>
          <input type="text" id="fInvNum" placeholder="INV-2025-XXX"/>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Invoice date</label>
            <input type="date" id="fInvDate" value="${today()}"/>
          </div>
          <div class="form-group">
            <label>Due date</label>
            <input type="date" id="fInvDue"/>
          </div>
        </div>
        <div class="form-group">
          <label>Amount ($)</label>
          <input type="number" id="fInvAmount" placeholder="0.00"/>
        </div>
        <div class="form-actions">
          <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
          <button class="btn-primary" onclick="app.saveInvoice()">Save invoice</button>
        </div>`;
    }

    if (type === 'viewInvoice') {
      const inv = data;
      const remaining = inv.amount - inv.paid;
      const daysOverdue = inv.status === 'overdue' ? Math.round((new Date() - new Date(inv.due)) / 86400000) : 0;
      title.textContent = `Invoice ${inv.invoiceNum}`;
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div class="form-group"><label>Vendor</label><div style="font-weight:500;padding:6px 0">${inv.vendor}</div></div>
          <div class="form-group"><label>Status</label><div style="padding:6px 0"><span class="badge badge-${inv.status}">${inv.status}</span></div></div>
          <div class="form-group"><label>Invoice date</label><div style="padding:6px 0">${inv.date}</div></div>
          <div class="form-group"><label>Due date</label><div style="padding:6px 0;${inv.status==='overdue'?'color:var(--red)':''}">${inv.due}${daysOverdue>0?` <span style="font-size:10px">(${daysOverdue}d overdue)</span>`:''}</div></div>
          <div class="form-group"><label>Invoice amount</label><div style="font-weight:600;font-family:var(--mono);padding:6px 0">${fmt(inv.amount)}</div></div>
          <div class="form-group"><label>Amount paid</label><div style="font-weight:600;font-family:var(--mono);padding:6px 0;color:var(--green)">${inv.paid ? fmt(inv.paid) : '—'}</div></div>
        </div>
        <div style="background:var(--surface2);border-radius:var(--radius);padding:12px;display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <span style="font-size:12px;font-weight:500">Remaining balance</span>
          <span style="font-size:16px;font-weight:600;font-family:var(--mono);color:${remaining>0?'var(--red)':'var(--green)'}">${fmt(remaining)}</span>
        </div>
        <div class="form-actions">
          <button class="btn-outline" onclick="app.closeModal()">Close</button>
          ${inv.status !== 'paid' ? `<button class="btn-primary" onclick="app.payInvoice('${inv.id}');app.closeModal()">Mark as paid</button>` : ''}
        </div>`;
    }

    if (type === 'addAccount') {
      title.textContent = 'New Account';
      body.innerHTML = `
        <div class="form-row">
          <div class="form-group">
            <label>Account code</label>
            <input type="text" id="fCoaCode" placeholder="e.g. 6650"/>
          </div>
          <div class="form-group">
            <label>Account type</label>
            <select id="fCoaType">
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="revenue">Revenue</option>
              <option value="expense" selected>Expense</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Account name</label>
          <input type="text" id="fCoaName" placeholder="e.g. Travel & Entertainment"/>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Subtype</label>
            <input type="text" id="fCoaSubtype" placeholder="e.g. opex"/>
          </div>
          <div class="form-group">
            <label>P&L / BS line</label>
            <input type="text" id="fCoaLine" placeholder="e.g. Other opex"/>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
          <button class="btn-primary" onclick="app.saveAccount()">Add account</button>
        </div>`;
    }

    if (type === 'importCSV') {
      title.textContent = 'Import Transactions';
      // Pre-populate entity from global filter if not already set
      if (!this._csvImportEntity && state.globalEntity && state.globalEntity !== 'all') {
        this._csvImportEntity = state.globalEntity.toUpperCase();
      }
      const uploadEntityOptions = ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS','SP1'].map(e =>
        `<option value="${e}" ${(this._csvImportEntity||'') === e ? 'selected' : ''}>${e}</option>`
      ).join('');
      body.innerHTML = `
        <div style="margin-bottom:16px">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:4px">Fallback Entity <span style="font-weight:400;font-style:italic">(auto-detected from bank account name · optional)</span></div>
          <select id="uploadEntityPre" class="filter-select" style="width:100%" onchange="app._csvImportEntity=this.value">
            <option value="">— auto-detect only —</option>
            ${uploadEntityOptions}
          </select>
        </div>
        <div style="margin-bottom:20px">
          <label class="csv-drop-zone" for="csvFileInput" id="csvDropZone" style="padding:32px 20px">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.5" style="margin-bottom:10px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div style="font-size:13px;font-weight:500;color:var(--text)">Drop a file here</div>
            <div style="font-size:11px;color:var(--text3);margin-top:4px">CSV, XLS, or XLSX · or click to browse</div>
          </label>
          <input type="file" id="csvFileInput" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none" onchange="app.handleCSVFile(this)"/>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:14px">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:8px">Auto-detected column names</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${['date / accounting date','description / memo','amount','vendor / payee','entity','type','category','status'].map(t =>
              `<span style="font-size:10px;background:var(--surface2);color:var(--text2);padding:2px 8px;border-radius:4px;border:1px solid var(--border)">${t}</span>`
            ).join('')}
          </div>
        </div>`;
      setTimeout(() => {
        const zone = document.getElementById('csvDropZone');
        if (!zone) return;
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
          e.preventDefault();
          zone.classList.remove('drag-over');
          const file = e.dataTransfer.files[0];
          if (!file) return;
          app.readSpreadsheetFile(file, (headers, rows) => {
            app._csvImportData = { headers, rows };
            app.renderCSVMappingUI(headers, rows);
          });
        });
      }, 0);
    }
  },

  closeModal() { document.getElementById('modalOverlay').classList.remove('open'); },

  async drillDown(accountId, label) {
    const range = state.globalPeriodRange;
    let q = supabaseClient
      .from('transactions')
      .select('id, acc_date, description, entity, amount, account_id')
      .eq('account_id', accountId)
      .order('acc_date', { ascending: false });
    if (range) q = q.gte('acc_date', range.from).lte('acc_date', range.to);
    const { data: txns, error } = await q;
    if (error) { this.showToast('Failed to load transactions', 'error'); return; }

    const acctOpts = (DATA.coa || []).map(a =>
      `<option value="${a.id}">${a.code} — ${a.name}</option>`
    ).join('');

    const rows = (txns || []).map(t => {
      const amt = Number(t.amount);
      const color = amt >= 0 ? 'var(--green,#059669)' : 'var(--red,#dc2626)';
      const amtStr = amt < 0 ? `(${fmt(Math.abs(amt))})` : fmt(amt);
      return `<tr>
        <td style="white-space:nowrap">${t.acc_date || ''}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description || ''}</td>
        <td>${t.entity || ''}</td>
        <td style="color:${color};font-weight:600;font-variant-numeric:tabular-nums;text-align:right">${amtStr}</td>
        <td>
          <select onchange="app.reTag('${t.id}',this.value)" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:3px;background:var(--surface)">
            <option value="">— keep —</option>${acctOpts}
          </select>
        </td>
      </tr>`;
    }).join('');

    const total = (txns || []).reduce((s, t) => s + Number(t.amount), 0);
    const totalColor = total >= 0 ? 'var(--green,#059669)' : 'var(--red,#dc2626)';
    const totalStr = total < 0 ? `(${fmt(Math.abs(total))})` : fmt(total);

    document.getElementById('modalTitle').textContent = label;
    document.getElementById('modalBody').innerHTML = `
      <div style="font-size:12px;color:var(--text3);margin-bottom:10px">
        ${(txns||[]).length} transaction${(txns||[]).length !== 1 ? 's' : ''} · ${this.getPeriodLabel(state.globalPeriod)}
        <span style="float:right;font-weight:600;color:${totalColor}">Total: ${totalStr}</span>
      </div>
      <div class="tbl-wrap" style="max-height:420px;overflow-y:auto">
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>Date</th><th>Description</th><th>Entity</th>
            <th style="text-align:right">Amount</th><th>Re-tag</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text3)">No transactions in this period</td></tr>'}</tbody>
        </table>
      </div>
      <div class="form-actions" style="margin-top:12px">
        <button class="btn-outline" onclick="app.closeModal()">Close</button>
      </div>
    `;
    document.getElementById('modalOverlay').classList.add('open');
  },

  async reTag(txnId, newAccountId) {
    if (!newAccountId) return;
    const { error } = await supabaseClient
      .from('transactions')
      .update({ account_id: newAccountId })
      .eq('id', txnId);
    if (error) { this.showToast('Re-tag failed', 'error'); return; }
    this.showToast('Transaction re-tagged — refresh report to see updated totals', 'success');
  },

  // ---- INBOX ----
  async renderInbox() {
    const el = document.getElementById('inboxContent');
    if (!el) return;
    el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

    const { data: accounts } = await supabaseClient
      .from('accounts').select('id, account_code, account_name, account_type')
      .order('account_code');

    const PAGE = 200;
    const loadAll = this._inboxLoadAll || false;
    const mode = state.inboxMode || 'bank';

    // Build base query with mode filter
    let baseQuery = supabaseClient
      .from('raw_transactions').select('*', { count: 'exact' }).eq('classified', false)
      .order('transaction_date', { ascending: false });

    if (mode === 'bank') {
      baseQuery = baseQuery
        .not('description', 'ilike', '%BUS ONL TFR TO%')
        .not('description', 'ilike', '%AMEX%')
        .neq('source', 'credit_card');
    } else if (mode === 'internal') {
      baseQuery = baseQuery.ilike('description', '%BUS ONL TFR TO%');
    } else if (mode === 'cc') {
      baseQuery = baseQuery.ilike('description', '%AMEX%');
    }

    // Apply active filters
    baseQuery = this.applyInboxFilters(baseQuery);

    const { data: rawTxns, count: totalCount, error } = await (loadAll ? baseQuery : baseQuery.limit(PAGE));

    if (error) { this.toast('Failed to load transactions'); console.error(error); return; }

    const txns = rawTxns || [];
    const hasMore = !loadAll && (totalCount || 0) > PAGE;
    const acctOptions = (accounts || []).map(a =>
      `<option value="${a.id}">${a.account_code} — ${a.account_name}</option>`
    ).join('');

    const allEntityCodes = ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS','SP1'];

    // Update sidebar badge with total unclassified bank count (all modes)
    const badge = document.getElementById('reviewBadge');
    if (badge && mode === 'bank') badge.textContent = (totalCount || txns.length) || '';

    const f = state.inboxFilter;
    const tabBtn = (m, label) => `<button class="btn-outline" style="font-size:12px;padding:4px 12px;${mode===m?'background:var(--accent);color:#fff;border-color:var(--accent)':''}" onclick="app.setInboxMode('${m}')">${label}</button>`;

    const filterRow = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 16px;background:var(--surface2);border-bottom:1px solid var(--border);flex-wrap:wrap">
        <input type="text" placeholder="Search description…" value="${f.search.replace(/"/g,'&quot;')}"
          style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);width:200px"
          oninput="app.updateInboxFilter('search',this.value)">
        <input type="date" value="${f.from}" title="From date"
          style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)"
          onchange="app.updateInboxFilter('from',this.value)">
        <input type="date" value="${f.to}" title="To date"
          style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)"
          onchange="app.updateInboxFilter('to',this.value)">
        <select style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)"
          onchange="app.updateInboxFilter('entity',this.value)">
          <option value="">All Entities</option>
          ${allEntityCodes.map(e => `<option value="${e}" ${f.entity===e?'selected':''}>${e}</option>`).join('')}
        </select>
        <select style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)"
          onchange="app.updateInboxFilter('direction',this.value)">
          <option value="">All Directions</option>
          <option value="DEBIT" ${f.direction==='DEBIT'?'selected':''}>Debit (out)</option>
          <option value="CREDIT" ${f.direction==='CREDIT'?'selected':''}>Credit (in)</option>
        </select>
        ${(f.search||f.from||f.to||f.entity||f.direction) ? `<button class="btn-outline" style="font-size:11px;padding:3px 10px;color:var(--red);border-color:var(--red)" onclick="app.updateInboxFilter('search','');app.updateInboxFilter('from','');app.updateInboxFilter('to','');app.updateInboxFilter('entity','');app.updateInboxFilter('direction','')">Clear</button>` : ''}
      </div>`;

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left">
          <button class="btn-primary" onclick="app.openImportModal()">↑ Upload CSV</button>
          <button class="btn-outline" onclick="app.openModal('newRawTxn')">+ Manual Entry</button>
          <button class="btn-outline" onclick="app.openRulesModal()" style="font-size:12px">⚡ Rules</button>
          <div style="display:flex;gap:4px;margin-left:8px;border-left:1px solid var(--border);padding-left:8px">
            ${tabBtn('bank','All Bank')}
            ${tabBtn('internal','Internal Transfers')}
            ${tabBtn('cc','Credit Card')}
          </div>
        </div>
        <div class="toolbar-right">
          <span style="font-size:13px;color:var(--text3)">${txns.length}${totalCount > txns.length ? ' of ' + totalCount : ''} transaction${txns.length !== 1 ? 's' : ''}</span>
          <button class="btn-outline" style="font-size:12px;padding:5px 12px" onclick="app.bulkClassifyAutoTagged()">⚡ Auto-Tagged</button>
          <button class="btn-primary" id="bulkClassifyBtn" style="display:none;background:var(--green,#16a34a);border-color:var(--green,#16a34a)" onclick="app.bulkClassify()">Finalize Selected</button>
          <button class="btn-outline" id="bulkDeleteBtn" style="display:none;color:var(--red);border-color:var(--red)" onclick="app.bulkDelete()">Delete Selected</button>
        </div>
      </div>
      ${filterRow}
      ${txns.length === 0 ? `
        <div style="padding:64px;text-align:center;color:var(--text3)">
          <p style="font-size:15px;margin-bottom:8px">No transactions</p>
          <p style="font-size:13px">${mode === 'bank' ? 'Upload a CSV or add a manual transaction to get started.' : 'No transactions match this filter.'}</p>
        </div>
      ` : `
        <div class="table-wrap">
          <table class="data-table" id="inboxTable">
            <thead>
              <tr>
                <th><input type="checkbox" id="inboxSelectAll" onchange="app.toggleSelectAll(this)"></th>
                <th>Date</th><th>Bank Account</th><th>Acct #</th><th>Description</th><th>Entity</th><th>Amount</th><th>Source</th>
                <th style="min-width:260px">Category (COA)</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${txns.map(t => `
                <tr data-id="${t.id}">
                  <td><input type="checkbox" class="row-check" onchange="app.onRowCheck()"></td>
                  <td style="white-space:nowrap">${t.transaction_date || ''}</td>
                  <td style="font-size:12px;color:var(--text);white-space:nowrap;cursor:default" title="Read-only — from CSV">${t.bank_account || '—'}</td>
                  <td style="font-size:12px;color:var(--text);white-space:nowrap;font-family:var(--mono);cursor:default" title="Read-only — from CSV">${t.account_number || '—'}</td>
                  <td><input type="text" class="desc-edit" data-id="${t.id}" value="${(t.description || '').replace(/"/g,'&quot;')}" style="font-size:13px;border:1px solid transparent;background:transparent;width:100%;min-width:180px;padding:2px 4px;border-radius:4px" onblur="app.saveDescEdit(this)" onfocus="this.style.borderColor='var(--border)'" onblur="this.style.borderColor='transparent';app.saveDescEdit(this)"></td>
                  <td>
                    <select class="entity-sel filter-select" data-id="${t.id}" style="font-size:12px;padding:2px 6px">
                      <option value="">— entity —</option>
                      ${allEntityCodes.map(e =>
                        `<option value="${e}" ${(window._entityById[t.entity_id]||'').toUpperCase() === e.toUpperCase() ? 'selected' : ''}>${e}</option>`
                      ).join('')}
                    </select>
                  </td>
                  <td style="font-variant-numeric:tabular-nums;color:${t.direction === 'DEBIT' ? 'var(--red)' : t.direction === 'CREDIT' ? 'var(--green)' : 'var(--text2)'};font-weight:600">
                    ${t.direction === 'DEBIT' ? `(${fmt(Math.abs(t.amount))})` : fmt(Number(t.amount))}
                  </td>
                  <td><span style="font-size:11px;background:var(--surface2);padding:2px 6px;border-radius:4px;border:1px solid var(--border)">${t.source || 'manual'}</span></td>
                  <td>
                    <select class="acct-sel filter-select" data-id="${t.id}" style="font-size:12px;padding:2px 6px" onchange="if(this.value==='__new__'){this.value='';app.openNewAccountModal();}else{const btn=this.closest('tr').querySelector('.classify-btn');if(btn){btn.style.opacity=this.value?'1':'0.35';btn.style.background=this.value?'var(--green,#16a34a)':''}}">
                      <option value="">— select account —</option>
                      ${acctOptions}
                      <option value="__new__">+ New account</option>
                    </select>
                  </td>
                  <td style="white-space:nowrap">
                    <button class="btn-primary classify-btn" style="font-size:12px;padding:4px 10px;background:var(--green,#16a34a);border-color:var(--green,#16a34a);opacity:0.35" onclick="app.classifyRow('${t.id}')">Classify</button>
                    <button class="btn-primary" style="font-size:12px;padding:4px 8px;background:var(--red);border-color:var(--red);margin-left:4px" onclick="app.deleteRow('${t.id}')">✕</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${hasMore ? `
          <div style="padding:12px 16px;background:var(--surface2);border-top:1px solid var(--border);display:flex;align-items:center;gap:12px">
            <span style="font-size:12px;color:var(--text3)">Showing ${txns.length} of ${totalCount} transactions</span>
            <button class="btn-outline" style="font-size:12px;padding:4px 12px" onclick="app._inboxLoadAll=true;app.renderInbox()">Load all ${totalCount}</button>
          </div>` : ''}
      `}
    `;
    // Apply auto-classification rules after render
    this.applyClassificationRules();
  },

  // ---- CREDIT CARD TRANSACTIONS PAGE ----
  async renderCCInbox() {
    const el = document.getElementById('ccInboxContent');
    if (!el) return;
    el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

    const { data: accounts } = await supabaseClient
      .from('accounts').select('id, account_code, account_name, account_type')
      .order('account_code');

    const PAGE = 200;
    const loadAll = this._ccLoadAll || false;
    let baseQuery = supabaseClient
      .from('raw_transactions').select('*', { count: 'exact' })
      .eq('classified', false)
      .eq('source', 'credit_card')
      .order('transaction_date', { ascending: false });

    const { data: rawTxns, count: totalCount, error } = await (loadAll ? baseQuery : baseQuery.limit(PAGE));
    if (error) { this.toast('Failed to load CC transactions'); console.error(error); return; }

    const txns = rawTxns || [];
    const hasMore = !loadAll && (totalCount || 0) > PAGE;

    // Update CC badge
    const badge = document.getElementById('ccBadge');
    if (badge) badge.textContent = (totalCount || txns.length) || '';

    const acctOptions = (accounts || []).map(a =>
      `<option value="${a.id}">${a.account_code} — ${a.account_name}</option>`
    ).join('');
    const ccEntityCodes = ['LP','BP','SP1'];

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left">
          <button class="btn-primary" onclick="app.openImportModal('cc')">↑ Upload CC Statement</button>
          <button class="btn-outline" onclick="app.openRulesModal()" style="font-size:12px">⚡ Rules</button>
        </div>
        <div class="toolbar-right">
          <span style="font-size:13px;color:var(--text3)">${txns.length}${totalCount > txns.length ? ' of ' + totalCount : ''} CC charge${txns.length !== 1 ? 's' : ''}</span>
          <span id="ccBulkCompanyWrap" style="display:none;align-items:center;gap:6px">
            <select id="ccBulkCompanySel" class="filter-select" style="font-size:12px;padding:4px 8px">
              <option value="">Set Company…</option>
              <option value="LP">LP</option>
              <option value="BP">BP</option>
              <option value="SP1">SP1</option>
            </select>
            <button class="btn-outline" style="font-size:12px;padding:4px 10px" onclick="app.bulkSetCCCompany()">Apply</button>
          </span>
          <button class="btn-outline" style="font-size:12px;padding:5px 12px" onclick="app.bulkClassifyAutoTagged()">⚡ Auto-Tagged</button>
          <button class="btn-primary" id="bulkClassifyBtn" style="display:none;background:var(--green,#16a34a);border-color:var(--green,#16a34a)" onclick="app.bulkClassify()">Finalize Selected</button>
          <button class="btn-outline" id="bulkDeleteBtn" style="display:none;color:var(--red);border-color:var(--red)" onclick="app.bulkDelete()">Delete Selected</button>
        </div>
      </div>
      ${txns.length === 0 ? `
        <div style="padding:64px;text-align:center;color:var(--text3)">
          <p style="font-size:15px;margin-bottom:8px">No unclassified credit card charges</p>
          <p style="font-size:13px">Upload a CC statement CSV to get started.</p>
        </div>
      ` : `
        <div class="table-wrap">
          <table class="data-table" id="inboxTable">
            <thead>
              <tr>
                <th><input type="checkbox" id="inboxSelectAll" onchange="app.toggleSelectAll(this)"></th>
                <th style="white-space:nowrap">Date</th><th>Description</th><th>Company</th><th style="white-space:nowrap">Amount</th>
                <th style="min-width:260px">Category (COA)</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${txns.map(t => `
                <tr data-id="${t.id}">
                  <td><input type="checkbox" class="row-check" onchange="app.onRowCheck()"></td>
                  <td style="white-space:nowrap">${t.transaction_date || ''}</td>
                  <td><input type="text" class="desc-edit" data-id="${t.id}" value="${(t.description || '').replace(/"/g,'&quot;')}" style="font-size:13px;border:1px solid transparent;background:transparent;width:100%;min-width:180px;padding:2px 4px;border-radius:4px" onblur="app.saveDescEdit(this)" onfocus="this.style.borderColor='var(--border)'" onblur="this.style.borderColor='transparent';app.saveDescEdit(this)"></td>
                  <td>
                    <select class="entity-sel filter-select" data-id="${t.id}" style="font-size:12px;padding:2px 6px">
                      <option value="">— select —</option>
                      ${ccEntityCodes.map(e =>
                        `<option value="${e}" ${(window._entityById[t.entity_id]||'').toUpperCase() === e.toUpperCase() ? 'selected' : ''}>${e}</option>`
                      ).join('')}
                    </select>
                  </td>
                  <td style="font-variant-numeric:tabular-nums;color:${t.direction === 'DEBIT' ? 'var(--red)' : t.direction === 'CREDIT' ? 'var(--green)' : 'var(--text2)'};font-weight:600">
                    ${t.direction === 'DEBIT' ? `(${fmt(Math.abs(t.amount))})` : fmt(Number(t.amount))}
                  </td>
                  <td>
                    <select class="acct-sel filter-select" data-id="${t.id}" style="font-size:12px;padding:2px 6px" onchange="if(this.value==='__new__'){this.value='';app.openNewAccountModal();}else{const btn=this.closest('tr').querySelector('.classify-btn');if(btn){btn.style.opacity=this.value?'1':'0.35';btn.style.background=this.value?'var(--green,#16a34a)':''}}">
                      <option value="">— select account —</option>
                      ${acctOptions}
                      <option value="__new__">+ New account</option>
                    </select>
                  </td>
                  <td style="white-space:nowrap">
                    <button class="btn-primary classify-btn" style="font-size:12px;padding:4px 10px;background:var(--green,#16a34a);border-color:var(--green,#16a34a);opacity:0.35" onclick="app.classifyRow('${t.id}')">Classify</button>
                    <button class="btn-primary" style="font-size:12px;padding:4px 8px;background:var(--red);border-color:var(--red);margin-left:4px" onclick="app.deleteRow('${t.id}')">✕</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${hasMore ? `
          <div style="padding:12px 16px;background:var(--surface2);border-top:1px solid var(--border);display:flex;align-items:center;gap:12px">
            <span style="font-size:12px;color:var(--text3)">Showing ${txns.length} of ${totalCount} CC charges</span>
            <button class="btn-outline" style="font-size:12px;padding:4px 12px" onclick="app._ccLoadAll=true;app.renderCCInbox()">Load all ${totalCount}</button>
          </div>` : ''}
      `}
    `;
    this.applyClassificationRules();
  },

  toggleSelectAll(checkbox) {
    const activePage = document.querySelector('.page.active');
    (activePage || document).querySelectorAll('.row-check').forEach(c => c.checked = checkbox.checked);
    this.onRowCheck();
  },

  onRowCheck() {
    // Clear any field-error highlights whenever selection changes
    const activePage = document.querySelector('.page.active');
    if (!activePage) return;
    activePage.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
    const checked = [...activePage.querySelectorAll('.row-check')].filter(c => c.checked);
    const n = checked.length;
    const classifyBtn = activePage.querySelector('#bulkClassifyBtn');
    const deleteBtn   = activePage.querySelector('#bulkDeleteBtn');
    const companyWrap = activePage.querySelector('#ccBulkCompanyWrap');
    if (classifyBtn) {
      classifyBtn.style.display = n > 0 ? 'inline-block' : 'none';
      classifyBtn.textContent = n > 0 ? `Finalize ${n} → Ledger` : 'Finalize → Ledger';
    }
    if (deleteBtn) deleteBtn.style.display = n > 0 ? 'inline-block' : 'none';
    if (companyWrap) companyWrap.style.display = n > 0 ? 'inline-flex' : 'none';
  },

  bulkSetCCCompany() {
    const activePage = document.querySelector('.page.active');
    const code = (activePage || document).querySelector('#ccBulkCompanySel')?.value;
    if (!code) { this.showToast('Select a company first', 'error'); return; }
    (activePage || document).querySelectorAll('.row-check:checked').forEach(cb => {
      const sel = cb.closest('tr')?.querySelector('.entity-sel');
      if (sel) sel.value = code;
    });
    this.showToast(`Company set to ${code}`, 'success');
  },

  // ---- AUTO-CLASSIFICATION RULES ----
  applyClassificationRules() {
    const rules = DATA.classificationRules || [];
    if (!rules.length) return;
    const activePage = document.querySelector('.page.active');
    (activePage || document).querySelectorAll('#inboxTable tbody tr[data-id]').forEach(row => {
      const descInput = row.querySelector('.desc-edit');
      const acctSel   = row.querySelector('.acct-sel');
      if (!descInput || !acctSel || acctSel.value) return; // skip if already assigned
      const desc = descInput.value.toLowerCase().replace(/\s+/g, ' ').trim();
      for (const rule of rules) {
        const pat = rule.pattern.trim().toLowerCase();
        if (pat && desc.includes(pat)) {
          acctSel.value = rule.account_id;
          // Trigger green classify button
          const btn = row.querySelector('.classify-btn');
          if (btn) { btn.style.opacity = '1'; btn.style.background = 'var(--green,#16a34a)'; }
          // Subtle highlight to show auto-matched
          row.style.background = 'rgba(37,99,235,0.04)';
          row.dataset.autoTagged = '1';
          break;
        }
      }
    });
  },

  openRulesModal() {
    const rules = DATA.classificationRules || [];
    const modal = document.getElementById('modalBody');
    const overlay = document.getElementById('modalOverlay');
    if (!modal || !overlay) return;

    const defaultPatterns = [
      'Google Ads','Bing Ads','Meta Ads','Stripe','PayPal','US CBP','UPS','FedEx'
    ];

    modal.innerHTML = `
      <div style="font-size:15px;font-weight:600;margin-bottom:4px">⚡ Classification Rules</div>
      <p style="font-size:12px;color:var(--text3);margin-bottom:14px">Rules auto-assign a category when a transaction description contains the pattern (case-insensitive). First match wins.</p>

      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:10px">Add / Edit Rule</div>
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:3px">Includes (word)</div>
            <input id="rulePatternInput" type="text" placeholder="e.g. GOOGLE" style="width:100%;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)">
          </div>
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:3px">Account</div>
            <input list="ruleAcctList" id="ruleAccountInput" type="text" placeholder="Search accounts…"
              style="width:100%;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)">
            <datalist id="ruleAcctList">
              ${(DATA.coa || []).map(a => `<option value="${a.code} — ${a.name}"></option>`).join('')}
            </datalist>
          </div>
          <button id="ruleSaveBtn" class="btn-primary" style="font-size:12px;padding:5px 14px" onclick="app.saveRule()">Save Rule</button>
        </div>
        <div style="margin-top:10px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Quick-add:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${defaultPatterns.map(p => `<button class="btn-outline" style="font-size:11px;padding:3px 10px" onclick="document.getElementById('rulePatternInput').value='${p}';document.getElementById('rulePatternInput').focus()">${p}</button>`).join('')}
          </div>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <input id="ruleSearch" type="text" placeholder="Search rules…"
          style="width:100%;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);margin-bottom:8px"
          oninput="app.filterRules()">
        <table class="data-table" style="font-size:12px">
          <thead><tr><th>#</th><th>Includes</th><th>Account</th><th></th></tr></thead>
          <tbody id="rulesTableBody">
            ${rules.length === 0
              ? `<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:16px">No rules yet — add one above</td></tr>`
              : rules.map((r, i) => `
                <tr data-rule-id="${r.id}">
                  <td style="font-size:11px;color:var(--text3)">${i+1}</td>
                  <td><code style="font-size:11px;background:var(--surface2);padding:1px 4px;border-radius:3px">${r.pattern}</code></td>
                  <td style="font-size:11px;color:var(--text2)">${(DATA.coa || []).find(a => a.id === r.account_id)?.name || r.account_id?.slice(0,8)+'…'}</td>
                  <td>
                    <button class="btn-outline" style="font-size:11px;padding:2px 8px;margin-right:4px" onclick="app.editRule('${r.id}','${r.pattern.replace(/'/g,"\\'")}','${r.account_id}')">Edit</button>
                    <button class="btn-outline" style="font-size:11px;padding:2px 8px;color:var(--red);border-color:var(--red)" onclick="app.deleteRule('${r.id}')">Delete</button>
                  </td>
                </tr>`).join('')
            }
          </tbody>
        </table>
      </div>

      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeModal()">Close</button>
      </div>
    `;
    document.getElementById('modalTitle').textContent = 'Classification Rules';
    overlay.classList.add('open');
  },

  filterRules() {
    const q = document.getElementById('ruleSearch')?.value?.toLowerCase() || '';
    document.querySelectorAll('#rulesTableBody tr[data-rule-id]').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = q === '' || text.includes(q) ? '' : 'none';
    });
  },

  editRule(id, pattern, accountId) {
    document.getElementById('rulePatternInput').value = pattern;
    const acct = (DATA.coa || []).find(a => a.id === accountId);
    if (acct) document.getElementById('ruleAccountInput').value = `${acct.code} — ${acct.name}`;
    const saveBtn = document.getElementById('ruleSaveBtn');
    saveBtn.dataset.editingId = id;
    saveBtn.textContent = 'Update Rule';
    // Scroll modal to top and focus the pattern input so user sees the form
    document.getElementById('modalOverlay').scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('rulePatternInput').focus();
  },

  async saveRule() {
    const pattern  = document.getElementById('rulePatternInput')?.value?.trim();
    const inputVal = document.getElementById('ruleAccountInput')?.value?.trim();
    const acct     = (DATA.coa || []).find(a => inputVal === a.code + ' — ' + a.name);
    const accountId = acct?.id;
    if (!pattern || !accountId) { this.showToast('Enter a keyword and select an account', 'error'); return; }

    const editingId = document.getElementById('ruleSaveBtn')?.dataset?.editingId;
    let error;
    if (editingId) {
      ({ error } = await supabaseClient.from('classification_rules')
        .update({ name: pattern, pattern, account_id: accountId })
        .eq('id', editingId));
      const sb = document.getElementById('ruleSaveBtn');
      delete sb.dataset.editingId;
      sb.textContent = 'Save Rule';
    } else {
      ({ error } = await supabaseClient.from('classification_rules')
        .insert({ name: pattern, pattern, account_id: accountId, is_active: true }));
    }
    if (error) { this.showToast('Failed to save rule: ' + (error.message || error.code), 'error'); console.error(error); return; }

    const { data: rules } = await supabaseClient.from('classification_rules').select('*').eq('is_active', true).order('created_at');
    DATA.classificationRules = rules || [];
    this.toast('Rule saved');
    this.openRulesModal();
  },

  async deleteRule(ruleId) {
    const { error } = await supabaseClient.from('classification_rules').delete().eq('id', ruleId);
    if (error) { this.toast('Failed to delete rule'); return; }
    DATA.classificationRules = DATA.classificationRules.filter(r => r.id !== ruleId);
    this.toast('Rule deleted');
    this.openRulesModal();
  },

  // ---- CLASSIFY SINGLE ROW ----
  async classifyRow(rawId) {
    const row = document.querySelector(`tr[data-id="${rawId}"]`);
    if (!row) return;
    const accountId  = row.querySelector('.acct-sel')?.value;
    if (!accountId)  { this.toast('Select a category first'); return; }

    const { data: t, error: loadErr } = await supabaseClient
      .from('raw_transactions').select('*').eq('id', rawId).single();
    if (loadErr) { this.toast('Could not load transaction'); return; }

    // Resolve entity: DOM dropdown first, then fall back to entity_id stored from import
    const entityCode = row.querySelector('.entity-sel')?.value || window._entityById[t.entity_id] || '';
    if (!entityCode) { this.toast('Select an entity'); return; }

    const accPeriod = (t.accounting_date || t.transaction_date || '').slice(0, 7);
    const { data: closedCheck } = await supabaseClient
      .from('closed_periods').select('id').eq('period', accPeriod).eq('entity', entityCode).maybeSingle();
    if (closedCheck) { this.toast(`Period ${accPeriod} is closed`); return; }

    const amount = t.direction === 'DEBIT' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount));

    const { error: insErr } = await supabaseClient.from('transactions').insert({
      raw_transaction_id: rawId,
      entity: entityCode,
      account_id: accountId,
      amount,
      txn_date: this.normalizeDate(t.transaction_date),
      acc_date: this.normalizeDate(t.accounting_date || t.transaction_date),
      description: t.description || '',
      memo: ''
    });

    if (insErr) {
      if (insErr.code === '23505') this.toast('Already classified');
      else { this.toast('Error saving — see console'); console.error(insErr); }
      return;
    }

    await supabaseClient.from('raw_transactions').update({
      classified: true, classified_at: new Date().toISOString()
    }).eq('id', rawId);

    this.toast('Classified ✓');
    row.remove();
    const badge = document.getElementById('reviewBadge');
    if (badge) badge.textContent = Math.max(0, (parseInt(badge.textContent) || 0) - 1) || '';
    const countEl = document.querySelector('#inboxContent .toolbar-right span');
    if (countEl) {
      const n = Math.max(0, parseInt(countEl.textContent) - 1);
      countEl.textContent = n + ' to classify';
    }
  },

  // ---- BULK CLASSIFY ----
  async bulkClassify() {
    try {
      const activePage = document.querySelector('.page.active');
      const checkedRows = [...(activePage || document).querySelectorAll('.row-check:checked')].map(c => c.closest('tr'));
      if (!checkedRows.length) { this.showToast('No rows selected', 'error'); return; }

      const rowsMissingCategory = checkedRows.filter(r => !r.querySelector('.acct-sel')?.value);
      if (rowsMissingCategory.length > 0) {
        this.showToast(`${rowsMissingCategory.length} row(s) missing a category — assign one first`, 'error');
        rowsMissingCategory.forEach(r => r.querySelector('.acct-sel')?.closest('td')?.classList.add('field-error'));
        return;
      }

      this.showToast(`Finalizing ${checkedRows.length} transactions…`, 'info');

      // 1. Collect row data from DOM
      const rowData = [];
      let noEntity = 0;
      for (const row of checkedRows) {
        const rawId = row?.dataset?.id;
        if (!rawId) continue;
        const accountId = row.querySelector('.acct-sel')?.value;
        if (!accountId) continue;
        const entityCode = row.querySelector('.entity-sel')?.value || '';
        rowData.push({ rawId, accountId, entityCode, row });
      }

      // 2. Batch-fetch all raw_transactions in ONE query
      const rawIds = rowData.map(r => r.rawId);
      const { data: rawTxns, error: fetchErr } = await supabaseClient
        .from('raw_transactions').select('*').in('id', rawIds);
      if (fetchErr) { this.showToast('Failed to load transactions', 'error'); console.error(fetchErr); return; }

      const rawMap = {};
      (rawTxns || []).forEach(t => { rawMap[t.id] = t; });

      // 3. Build all insert records
      const inserts = [];
      const successIds = [];
      const successRows = [];
      let failed = 0;
      noEntity = 0;

      for (const rd of rowData) {
        const t = rawMap[rd.rawId];
        if (!t) { failed++; continue; }

        // Resolve entity: DOM dropdown → entity_id → bank_account keywords → description keywords
        let entityCode = rd.entityCode;
        if (!entityCode && t.entity_id) entityCode = (window._entityById[t.entity_id] || '').toUpperCase();
        if (!entityCode && t.bank_account) entityCode = detectEntityFromBankAccount(t.bank_account) || '';
        if (!entityCode && t.description) entityCode = detectEntityFromBankAccount(t.description) || '';
        if (!entityCode) { noEntity++; failed++; continue; }

        const rawAmt = Math.abs(Number(t.amount));
        let amount;
        if (t.direction === 'DEBIT' || t.direction === 'CREDIT') {
          amount = t.direction === 'DEBIT' ? -rawAmt : rawAmt;
        } else {
          const acct = (DATA.coa || []).find(a => a.id === rd.accountId);
          const debitTypes = ['expense', 'cogs', 'cost of goods', 'asset'];
          const isDebitAcct = debitTypes.some(dt => (acct?.account_type || '').toLowerCase().includes(dt))
            || debitTypes.some(dt => (acct?.account_subtype || '').toLowerCase().includes(dt));
          amount = isDebitAcct ? -rawAmt : rawAmt;
        }

        inserts.push({
          raw_transaction_id: rd.rawId, entity: entityCode, account_id: rd.accountId, amount,
          txn_date: this.normalizeDate(t.transaction_date), acc_date: this.normalizeDate(t.accounting_date || t.transaction_date),
          description: t.description || '', memo: ''
        });
        successIds.push(rd.rawId);
        successRows.push(rd.row);
      }

      if (!inserts.length) {
        this.showToast(noEntity > 0
          ? `${noEntity} row(s) have no entity — select an entity on each row or re-import with entity mapped`
          : `No valid rows to finalize`, 'error');
        return;
      }

      // 4. Batch-insert ALL transactions in ONE query
      const { error: insErr } = await supabaseClient.from('transactions').insert(inserts);
      if (insErr) {
        this.showToast(`Insert failed: ${insErr.message}`, 'error');
        console.error('bulkClassify insert error:', insErr);
        return;
      }

      // 5. Batch-update all raw_transactions as classified in ONE query
      await supabaseClient.from('raw_transactions')
        .update({ classified: true, classified_at: new Date().toISOString() })
        .in('id', successIds);

      // 6. Remove classified rows from DOM
      successRows.forEach(r => r.remove());

      const success = inserts.length;
      this.showToast(`${success} transaction${success !== 1 ? 's' : ''} moved to Ledger${failed ? ` · ${failed} skipped` : ''}`, 'success');

      const _activePage = document.querySelector('.page.active');
      const _cBtn = _activePage?.querySelector('#bulkClassifyBtn'); if (_cBtn) _cBtn.style.display = 'none';
      const _dBtn = _activePage?.querySelector('#bulkDeleteBtn'); if (_dBtn) _dBtn.style.display = 'none';
      const badge = document.getElementById('reviewBadge');
      if (badge) badge.textContent = Math.max(0, (parseInt(badge.textContent) || 0) - success) || '';

      // 7. Auto-switch period to match finalized transactions so they're visible in Ledger
      if (inserts.length > 0) {
        const dates = inserts.map(r => r.acc_date).filter(Boolean).sort();
        const earliest = dates[0];
        const latest = dates[dates.length - 1];
        if (earliest && earliest < state.globalPeriodRange?.from) {
          state.globalPeriod = 'custom';
          state.globalPeriodRange = { from: earliest.slice(0,7) + '-01', to: latest };
          this.showToast(`Period adjusted to show finalized transactions (${earliest} – ${latest})`, 'info');
        }
      }
    } catch (e) {
      this.showToast(`Finalize error: ${e.message}`, 'error');
      console.error('bulkClassify exception:', e);
    }
  },

  // ---- BULK CLASSIFY AUTO-TAGGED ----
  async bulkClassifyAutoTagged() {
    const activePage = document.querySelector('.page.active');
    const autoRows = [...(activePage || document).querySelectorAll('tr[data-auto-tagged="1"]')];
    if (!autoRows.length) {
      this.showToast('No auto-tagged transactions found', 'info');
      return;
    }
    // Check all auto-tagged rows and surface the Finalize button — don't auto-submit
    autoRows.forEach(r => {
      const cb = r.querySelector('.row-check');
      if (cb) cb.checked = true;
    });
    this.onRowCheck();
    const missing = autoRows.filter(r => !r.querySelector('.acct-sel')?.value).length;
    const msg = missing
      ? `${autoRows.length} rows selected — ${missing} still missing a category`
      : `${autoRows.length} rows selected — review and click Finalize to send to Ledger`;
    this.showToast(msg, missing ? 'error' : 'info');
  },

  // ---- DELETE SINGLE ROW ----
  async deleteRow(rawId) {
    if (!confirm('Delete this transaction?')) return;
    const { error } = await supabaseClient.from('raw_transactions').delete().eq('id', rawId);
    if (error) { this.toast('Delete failed — see console'); console.error(error); return; }
    document.querySelector(`tr[data-id="${rawId}"]`)?.remove();
    const badge = document.getElementById('reviewBadge');
    if (badge) badge.textContent = Math.max(0, (parseInt(badge.textContent) || 0) - 1) || '';
    const countEl = document.querySelector('#inboxContent .toolbar-right span');
    if (countEl) {
      const n = Math.max(0, parseInt(countEl.textContent) - 1);
      countEl.textContent = n + ' to classify';
    }
    this.toast('Deleted');
  },

  // ---- INLINE DESCRIPTION EDIT ----
  async saveDescEdit(input) {
    const rawId = input.dataset.id;
    const newDesc = input.value.trim();
    if (!newDesc || !rawId) return;
    const { error } = await supabaseClient.from('raw_transactions').update({ description: newDesc }).eq('id', rawId);
    if (error) { this.toast('Failed to save'); console.error(error); }
  },

  // ---- BULK DELETE ----
  async bulkDelete() {
    const activePage = document.querySelector('.page.active');
    const checkedRows = [...(activePage || document).querySelectorAll('.row-check:checked')].map(c => c.closest('tr'));
    if (!checkedRows.length) { this.toast('No rows selected'); return; }
    if (!confirm(`Delete ${checkedRows.length} transaction${checkedRows.length !== 1 ? 's' : ''}?`)) return;

    const ids = checkedRows.map(r => r.dataset.id);
    const { error } = await supabaseClient.from('raw_transactions').delete().in('id', ids);
    if (error) { this.toast('Delete failed — see console'); console.error(error); return; }

    checkedRows.forEach(r => r.remove());
    const badge = document.getElementById('reviewBadge');
    if (badge) badge.textContent = Math.max(0, (parseInt(badge.textContent) || 0) - ids.length) || '';
    const countEl = document.querySelector('#inboxContent .toolbar-right span');
    if (countEl) {
      const n = Math.max(0, parseInt(countEl.textContent) - ids.length);
      countEl.textContent = n + ' to classify';
    }
    const _ap = document.querySelector('.page.active');
    const _db = _ap?.querySelector('#bulkDeleteBtn'); if (_db) _db.style.display = 'none';
    const _cb = _ap?.querySelector('#bulkClassifyBtn'); if (_cb) _cb.style.display = 'none';
    const _sa = _ap?.querySelector('#inboxSelectAll'); if (_sa) _sa.checked = false;
    this.toast(`${ids.length} deleted`);
  },

  // ---- MANUAL RAW TXN ENTRY ----
  openModal_newRawTxn() {
    const title = document.getElementById('modalTitle');
    const body  = document.getElementById('modalBody');
    if (title) title.textContent = 'Add Transaction';
    if (body) body.innerHTML = `
      <div class="form-group"><label>Date</label>
        <input type="date" id="fRawDate" value="${today()}"/></div>
      <div class="form-group"><label>Description</label>
        <input type="text" id="fRawDesc" placeholder="e.g. Google Ads charge"/></div>
      <div class="form-group"><label>Amount</label>
        <input type="number" id="fRawAmount" placeholder="e.g. -1200.00" step="0.01"/>
        <div class="date-note">Negative = expense/payment out, Positive = income/deposit</div></div>
      <div class="form-row">
        <div class="form-group"><label>Entity</label>
          <select id="fRawEntity">
            <option>WB</option><option>LP</option><option>KP</option>
            <option>BP</option><option>WBP</option><option>ONEOPS</option>
          </select></div>
        <div class="form-group"><label>Source</label>
          <select id="fRawSource">
            <option value="manual">Manual</option><option value="bank">Bank</option><option value="csv">CSV</option>
          </select></div>
      </div>
      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="app.saveRawTxn()">Add to Inbox</button>
      </div>
    `;
    document.getElementById('modalOverlay').classList.add('open');
  },

  async saveRawTxn() {
    const date   = document.getElementById('fRawDate')?.value;
    const desc   = document.getElementById('fRawDesc')?.value?.trim();
    const amount = parseFloat(document.getElementById('fRawAmount')?.value);
    const entity = document.getElementById('fRawEntity')?.value;
    const source = document.getElementById('fRawSource')?.value || 'manual';
    if (!date || !desc || isNaN(amount)) { this.toast('Date, description, and amount are required'); return; }

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

  // ---- NEW ACCOUNT FROM INBOX ----
  openNewAccountModal() {
    const title = document.getElementById('modalTitle');
    const body  = document.getElementById('modalBody');
    if (title) title.textContent = 'New COA Account';
    if (body) body.innerHTML = `
      <div class="form-row">
        <div class="form-group"><label>Account Code</label>
          <input type="text" id="fNewAccCode" placeholder="e.g. 6650"/></div>
        <div class="form-group"><label>Type</label>
          <select id="fNewAccType">
            <option value="revenue">Revenue</option>
            <option value="expense" selected>Expense</option>
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
          </select></div>
      </div>
      <div class="form-group"><label>Account Name</label>
        <input type="text" id="fNewAccName" placeholder="e.g. Warehouse supplies"/></div>
      <div class="form-group"><label>Subtype</label>
        <input type="text" id="fNewAccSubtype" placeholder="e.g. opex, cogs, advertising"/></div>
      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="app.saveAccountFromInbox()">Create Account</button>
      </div>
    `;
    document.getElementById('modalOverlay').classList.add('open');
  },

  async saveAccountFromInbox() {
    const code    = document.getElementById('fNewAccCode')?.value?.trim();
    const name    = document.getElementById('fNewAccName')?.value?.trim();
    const type    = document.getElementById('fNewAccType')?.value;
    const subtype = document.getElementById('fNewAccSubtype')?.value?.trim();
    if (!code || !name) { this.toast('Code and name are required'); return; }

    const { error } = await supabaseClient.from('accounts').insert({
      account_code: code, account_name: name, account_type: type,
      account_subtype: subtype || type,
      normal_balance: (type === 'asset' || type === 'expense') ? 'DEBIT' : 'CREDIT',
      is_active: true
    });
    if (error) {
      if (error.code === '23505') this.toast('Account code already exists');
      else { this.toast('Failed — see console'); console.error(error); }
      return;
    }

    // Reload DATA.coa so new account appears in rules/classification dropdowns immediately
    const { data: freshAccounts } = await supabaseClient
      .from('accounts')
      .select('id, account_code, account_name, account_type, account_subtype, is_elimination');
    if (freshAccounts) {
      DATA.coa = freshAccounts.map(a => ({
        id: a.id,
        code: a.account_code,
        name: a.account_name,
        type: a.account_type,
        subtype: a.account_subtype,
        balance: 0,
        elimination: a.is_elimination || false
      }));
      freshAccounts.forEach(a => { window._accountById[a.id] = a.account_name; });
    }

    this.toast(`Account ${code} created`);
    this.closeModal();
    await this.renderInbox();
  },

  // ---- LEDGER ----
  async renderLedger() {
    const el = document.getElementById('ledgerContent');
    if (!el) return;
    el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

    const entity = state.globalEntity;
    const range = state.globalPeriodRange;

    let query = supabaseClient
      .from('transactions')
      .select('*, accounts(account_code, account_name, account_type)')
      .order('acc_date', { ascending: false });

    query = applyEntityFilter(query, entity);
    if (range) query = query.gte('acc_date', range.from).lte('acc_date', range.to);

    const { data: txns, error } = await query;
    if (error) { this.toast('Failed to load ledger'); console.error(error); return; }

    let rows = txns || [];
    let unclassifiedCount = 0;

    // Fallback: if period filter returned nothing, try without period to detect date format issues
    let showingAllPeriods = false;
    if (rows.length === 0 && range) {
      try {
        const { count } = await supabaseClient
          .from('raw_transactions')
          .select('*', { count: 'exact', head: true })
          .eq('classified', false)
          .gte('transaction_date', range.from)
          .lte('transaction_date', range.to);
        unclassifiedCount = count || 0;
      } catch (e) {
        unclassifiedCount = 0;
      }

      let fallbackQ = supabaseClient
        .from('transactions')
        .select('*, accounts(account_code, account_name, account_type)')
        .order('acc_date', { ascending: false });
      fallbackQ = applyEntityFilter(fallbackQ, entity);
      const { data: fallbackTxns } = await fallbackQ;
      if ((fallbackTxns || []).length > 0) {
        rows = fallbackTxns;
        showingAllPeriods = true;
      }
    }

    // Cache rows for client-side filtering
    this._ledgerRows = rows;
    if (!state.ledgerFilter) state.ledgerFilter = { search: '', account: '', direction: '' };

    // Build unique account options from fetched rows
    const accountMap = {};
    rows.forEach(t => {
      if (t.accounts) accountMap[t.account_id] = t.accounts.account_code + ' — ' + t.accounts.account_name;
    });
    const acctFilterOptions = Object.entries(accountMap)
      .sort((a,b) => a[1].localeCompare(b[1]))
      .map(([id, label]) => `<option value="${id}" ${state.ledgerFilter.account===id?'selected':''}>${label}</option>`)
      .join('');

    const lf = state.ledgerFilter;
    const entityLabel = entity === 'all' ? 'All Entities' : entity;
    const periodLabel = this.getPeriodLabel(state.globalPeriod);
    const emptyPeriodWarning = unclassifiedCount > 0
      ? `<span style="font-size:11px;color:var(--amber,#d97706);background:rgba(217,119,6,0.1);padding:4px 10px;border-radius:4px;flex:1">⚠ No classified transactions in ${periodLabel}. ${unclassifiedCount} unclassified transaction${unclassifiedCount !== 1 ? 's' : ''} pending — <span onclick="app.navigate('inbox')" style="cursor:pointer;text-decoration:underline;color:var(--accent)">Go to Classification →</span></span>`
      : (showingAllPeriods ? `<span style="font-size:11px;color:var(--amber,#d97706);background:rgba(217,119,6,0.1);padding:2px 8px;border-radius:4px">⚠ No transactions in selected period — showing all</span>` : '');

    const toolbar = `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg2)">
        <span style="font-size:12px;font-weight:600;background:var(--accent);color:#fff;padding:3px 10px;border-radius:20px">${entityLabel}</span>
        <span style="font-size:13px;color:var(--text2)">${showingAllPeriods ? 'All periods' : periodLabel}</span>
        ${emptyPeriodWarning}
        <span style="font-size:12px;color:var(--text3);margin-left:auto" id="ledgerRowCount">${rows.length} transaction${rows.length !== 1 ? 's' : ''}</span>
        <button id="ledgerBulkDeleteBtn" class="btn-outline" style="display:none;color:var(--red);border-color:var(--red);font-size:12px;padding:4px 12px" onclick="app.bulkDeleteLedger()">Delete Selected</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 16px;background:var(--surface2);border-bottom:1px solid var(--border);flex-wrap:wrap">
        <input type="text" id="ledgerSearchInput" placeholder="Search description or account…" value="${lf.search.replace(/"/g,'&quot;')}"
          style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);width:220px"
          oninput="app.setLedgerFilter('search',this.value)">
        <select id="ledgerAcctFilter" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)"
          onchange="app.setLedgerFilter('account',this.value)">
          <option value="">All Accounts</option>
          ${acctFilterOptions}
        </select>
        <select id="ledgerDirFilter" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)"
          onchange="app.setLedgerFilter('direction',this.value)">
          <option value="">All Directions</option>
          <option value="credit" ${lf.direction==='credit'?'selected':''}>Credits (income)</option>
          <option value="debit" ${lf.direction==='debit'?'selected':''}>Debits (expense)</option>
        </select>
        ${(lf.search||lf.account||lf.direction) ? `<button class="btn-outline" style="font-size:11px;padding:3px 10px;color:var(--red);border-color:var(--red)" onclick="state.ledgerFilter={search:'',account:'',direction:''};app.renderLedgerTable()">Clear</button>` : ''}
      </div>
    `;

    el.innerHTML = rows.length === 0 ? toolbar + `
      <div style="padding:64px;text-align:center;color:var(--text3)">
        <p style="font-size:15px;margin-bottom:8px">No classified transactions</p>
        <p style="font-size:13px">Classify transactions in Bank Transactions to see them here.</p>
      </div>
    ` : toolbar + `<div id="ledgerTableWrap"></div>`;

    if (rows.length > 0) this.renderLedgerTable();
  },

  renderLedgerTable() {
    const wrap = document.getElementById('ledgerTableWrap');
    if (!wrap) return;
    const lf = state.ledgerFilter || {};
    let rows = this._ledgerRows || [];

    // Apply client-side filters
    if (lf.search) {
      const q = lf.search.toLowerCase();
      rows = rows.filter(t =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.accounts ? t.accounts.account_code + ' ' + t.accounts.account_name : '').toLowerCase().includes(q)
      );
    }
    if (lf.account) rows = rows.filter(t => t.account_id === lf.account);
    if (lf.direction === 'credit') rows = rows.filter(t => Number(t.amount) >= 0);
    if (lf.direction === 'debit')  rows = rows.filter(t => Number(t.amount) < 0);

    // Update count label
    const countEl = document.getElementById('ledgerRowCount');
    if (countEl) countEl.textContent = `${rows.length} transaction${rows.length !== 1 ? 's' : ''}`;

    wrap.innerHTML = rows.length === 0 ? `
      <div style="padding:48px;text-align:center;color:var(--text3)">No transactions match the current filters.</div>
    ` : `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:32px"><input type="checkbox" id="ledgerSelectAll" onchange="app.onLedgerSelectAll(this)" title="Select all"></th>
              <th style="white-space:nowrap">Acc. Date</th><th>Description</th><th>Entity</th>
              <th>Category</th><th style="white-space:nowrap">Amount</th><th>Memo</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(t => {
              const amt = Number(t.amount);
              const amtColor = amt >= 0 ? 'var(--green,#059669)' : 'var(--red,#dc2626)';
              const amtDisplay = amt < 0 ? `(${fmt(Math.abs(amt))})` : fmt(amt);
              const category = t.accounts ? t.accounts.account_code + ' — ' + t.accounts.account_name : '';
              return `
              <tr data-txn-id="${t.id}">
                <td style="width:32px;padding:11px 8px"><input type="checkbox" class="ledger-check" onchange="app.onLedgerCheck()"></td>
                <td><div style="white-space:nowrap;font-size:12px">${t.acc_date || ''}</div></td>
                <td><div style="width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description || ''}</div></td>
                <td style="white-space:nowrap"><span style="font-size:11px;font-weight:600;background:var(--accent);color:#fff;padding:2px 8px;border-radius:20px">${t.entity || ''}</span></td>
                <td><div style="width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${category}</div></td>
                <td style="color:${amtColor};font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap">${amtDisplay}</td>
                <td><div style="width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text3);font-size:12px">${t.memo || ''}</div></td>
                <td style="white-space:nowrap">
                  <button class="btn-outline" style="font-size:12px;padding:4px 10px" onclick="app.editLedgerRow('${t.id}')">Edit</button>
                  <button class="btn-primary" style="font-size:12px;padding:4px 8px;background:var(--red);border-color:var(--red);margin-left:4px" onclick="app.deleteLedgerRow('${t.id}')">✕</button>
                </td>
              </tr>
            `}).join('')}
          </tbody>
        </table>
      </div>
    `;

  },

  onLedgerSelectAll(cb) {
    document.querySelectorAll('.ledger-check').forEach(c => c.checked = cb.checked);
    this.onLedgerCheck();
  },

  onLedgerCheck() {
    const n = document.querySelectorAll('.ledger-check:checked').length;
    const btn = document.getElementById('ledgerBulkDeleteBtn');
    if (btn) {
      btn.style.display = n > 0 ? 'inline-block' : 'none';
      btn.textContent = n > 0 ? `Delete ${n} Selected` : 'Delete Selected';
    }
  },

  async bulkDeleteLedger() {
    const checked = [...document.querySelectorAll('.ledger-check:checked')];
    if (!checked.length) return;
    if (!confirm(`Delete ${checked.length} transaction${checked.length !== 1 ? 's' : ''} from the ledger? This cannot be undone.`)) return;
    const ids = checked.map(c => c.closest('tr[data-txn-id]')?.dataset.txnId).filter(Boolean);
    const { error } = await supabaseClient.from('transactions').delete().in('id', ids);
    if (error) { this.showToast('Delete failed — see console', 'error'); console.error(error); return; }
    this.showToast(`${ids.length} transaction${ids.length !== 1 ? 's' : ''} deleted`, 'success');
    await this.renderLedger();
  },

  setLedgerFilter(field, value) {
    if (!state.ledgerFilter) state.ledgerFilter = { search: '', account: '', direction: '' };
    state.ledgerFilter[field] = value;
    this.renderLedgerTable();
  },

  async editLedgerRow(txnId) {
    const { data: t, error } = await supabaseClient
      .from('transactions').select('*, accounts(id, account_code, account_name)').eq('id', txnId).single();
    if (error) { this.toast('Could not load transaction'); return; }

    const { data: accounts } = await supabaseClient
      .from('accounts').select('id, account_code, account_name').order('account_code');

    const acctOptions = (accounts || []).map(a =>
      `<option value="${a.id}" ${a.id === t.account_id ? 'selected' : ''}>${a.account_code} — ${a.account_name}</option>`
    ).join('');

    const title = document.getElementById('modalTitle');
    const body  = document.getElementById('modalBody');
    if (title) title.textContent = 'Edit Transaction';
    if (body) body.innerHTML = `
      <div class="form-group"><label>Category (COA)</label>
        <select id="fEditAcct">${acctOptions}</select></div>
      <div class="form-group"><label>Accounting Date</label>
        <input type="date" id="fEditAccDate" value="${t.acc_date || ''}"/></div>
      <div class="form-group"><label>Memo</label>
        <input type="text" id="fEditMemo" value="${t.memo || ''}"/></div>
      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="app.saveLedgerEdit('${txnId}')">Save</button>
      </div>
    `;
    document.getElementById('modalOverlay').classList.add('open');
  },

  async saveLedgerEdit(txnId) {
    const accountId = document.getElementById('fEditAcct')?.value;
    const accDate   = document.getElementById('fEditAccDate')?.value;
    const memo      = document.getElementById('fEditMemo')?.value?.trim();
    if (!accountId || !accDate) { this.toast('Category and date are required'); return; }

    const { error } = await supabaseClient.from('transactions').update({
      account_id: accountId, acc_date: accDate, memo: memo || null
    }).eq('id', txnId);
    if (error) { this.toast('Save failed — see console'); console.error(error); return; }

    this.toast('Updated ✓');
    this.closeModal();
    await this.renderLedger();
  },

  async deleteLedgerRow(txnId) {
    if (!confirm('Delete this transaction from the ledger? This cannot be undone.')) return;
    const { error } = await supabaseClient.from('transactions').delete().eq('id', txnId);
    if (error) { this.toast('Delete failed — see console'); console.error(error); return; }
    this.toast('Deleted ✓');
    await this.renderLedger();
  },

  // ---- SAVE HANDLERS ----
  async saveTransaction() {
    const txnDate  = document.getElementById('fTxnDate')?.value;
    const accDate  = document.getElementById('fAccDate')?.value;
    const entity   = document.getElementById('fEntity')?.value;
    const type     = document.getElementById('fType')?.value;
    const desc     = document.getElementById('fDesc')?.value?.trim();
    const vendor   = document.getElementById('fVendor')?.value?.trim();
    const amount   = parseFloat(document.getElementById('fAmount')?.value || '0');
    const category = document.getElementById('fCategory')?.value;
    const source   = document.getElementById('fSource')?.value;

    if (!desc || !amount) { this.toast('Description and amount are required'); return; }

    const entityCode = entity === 'WB (consolidated)' ? 'WB' : entity;
    const isIncome = type === 'income' || type === 'transfer';

    if (supabaseClient) {
      const entityId = window._entityByCode[entityCode] || null;
      const { error } = await supabaseClient.from('raw_transactions').insert({
        entity_id: entityId,
        source: source || 'manual',
        external_id: 'ui-' + Date.now(),
        transaction_date: txnDate,
        accounting_date: accDate,
        amount: Math.abs(amount),
        direction: isIncome ? 'CREDIT' : 'DEBIT',
        description: desc,
        vendor: vendor || '',
        txn_type: type,
        category: category,
        status: 'review'
      });
      if (!error) {
        await loadDataFromSupabase();
        if (state.currentPage === 'inbox') await this.renderInbox();
        this.toast('Transaction saved');
        this.closeModal();
      } else {
        console.error('Save txn error:', error);
        this.toast('Error saving — check console');
      }
    } else {
      DATA.transactions.unshift({
        id: 'T' + Date.now(),
        entity: entityCode, desc, vendor: vendor || '', type, category,
        amount: isIncome ? Math.abs(amount) : -Math.abs(amount),
        txnDate, accDate, status: 'review', source: source || 'manual'
      });
      state.filteredTxns = [...DATA.transactions];
      this.renderTransactionRows();
      this.toast('Transaction added (local only — configure Supabase to persist)');
      this.closeModal();
    }
  },

  async saveVendor() {
    const name     = document.getElementById('fVendorName')?.value?.trim();
    const type     = document.getElementById('fVendorType')?.value;
    const category = document.getElementById('fVendorCategory')?.value || null;
    if (!name) { this.showToast('Vendor name is required', 'error'); return; }

    if (supabaseClient) {
      const { error } = await supabaseClient.from('vendors').insert({
        name, vendor_type: type, default_category: category, status: 'active', ytd_spend: 0, open_invoices: 0, overdue_count: 0
      });
      if (!error) {
        await loadDataFromSupabase();
        this.renderVendors();
        this.toast('Vendor saved');
        this.closeModal();
      } else {
        console.error('Save vendor error:', error);
        this.toast('Error saving vendor');
      }
    } else {
      DATA.vendors.push({ id: 'V' + Date.now(), name, type, ytd: 0, openInvoices: 0, overdue: 0, lastPayment: '', status: 'active' });
      this.renderVendors();
      this.toast('Vendor added (local only)');
      this.closeModal();
    }
  },

  async saveApItem() {
    const vendor    = document.getElementById('fApVendor')?.value?.trim();
    const entity    = document.getElementById('fApEntity')?.value;
    const invDate   = document.getElementById('fApInvDate')?.value;
    const dueDate   = document.getElementById('fApDueDate')?.value;
    const amount    = parseFloat(document.getElementById('fApAmount')?.value || '0');
    const memo      = document.getElementById('fApMemo')?.value?.trim();

    if (!vendor) { this.showToast('Vendor is required', 'error'); return; }
    if (!amount || amount <= 0) { this.showToast('Amount must be greater than 0', 'error'); return; }

    if (supabaseClient) {
      const { error } = await supabaseClient.from('ap_items').insert({
        vendor, entity, invoice_date: invDate || null, due_date: dueDate || null,
        amount, paid: false, dispute_note: memo || null
      });
      if (!error) {
        this.showToast('AP item saved', 'success');
        this.closeModal();
        await this.renderAP();
      } else {
        console.error('Save AP item error:', error);
        this.showToast('Error saving AP item', 'error');
      }
    } else {
      this.showToast('No database connection', 'error');
    }
  },

  openClearAllModal() {
    const title = document.getElementById('modalTitle');
    const body  = document.getElementById('modalBody');
    if (title) title.textContent = '⚠️ Clear All Data';
    if (body) body.innerHTML = `
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:14px 16px;margin-bottom:16px">
        <p style="font-weight:700;color:#dc2626;margin-bottom:8px">This will permanently delete:</p>
        <ul style="color:#dc2626;font-size:13px;padding-left:18px;line-height:1.8">
          <li>All bank &amp; CC transactions (inbox)</li>
          <li>All classified ledger transactions</li>
          <li>All journal entries &amp; ledger entries</li>
          <li>All vendors, invoices &amp; AP items</li>
        </ul>
      </div>
      <p style="font-size:13px;color:var(--text2);margin-bottom:12px">Type <strong>DELETE</strong> below to confirm. This cannot be undone.</p>
      <input type="text" id="clearConfirmInput" placeholder="Type DELETE here…"
        style="width:100%;padding:9px 12px;border:2px solid var(--border);border-radius:6px;font-size:14px;letter-spacing:1px"
        oninput="document.getElementById('clearAllConfirmBtn').disabled = this.value !== 'DELETE'"/>
      <div class="form-actions" style="margin-top:16px">
        <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
        <button id="clearAllConfirmBtn" class="btn-primary" disabled
          style="background:#dc2626;border-color:#dc2626"
          onclick="app.clearAllData()">Delete Everything</button>
      </div>`;
    document.getElementById('modalOverlay').classList.add('open');
  },

  async clearAllData() {
    const input = document.getElementById('clearConfirmInput')?.value;
    if (input !== 'DELETE') { this.showToast('Type DELETE to confirm', 'error'); return; }
    this.closeModal();
    this.showToast('Deleting all data…', 'error');
    const tables = ['transactions','raw_transactions','ledger_entries','journal_entries','ap_items','invoices','vendors'];
    const failed = [];
    for (const tbl of tables) {
      const { error } = await supabaseClient.from(tbl).delete().gte('id', '00000000-0000-0000-0000-000000000000');
      if (error) {
        console.error('Clear error for', tbl, error);
        failed.push(tbl);
      }
    }
    await loadDataFromSupabase();
    if (failed.length) {
      this.showToast(`Cleared most data. Failed: ${failed.join(', ')} — check console.`, 'error');
    } else {
      this.showToast('All data cleared. Starting fresh.', 'success');
    }
    this.navigate('dashboard');
  },

  async saveInvoice() {
    const vendorName  = document.getElementById('fInvVendor')?.value;
    const invoiceNum  = document.getElementById('fInvNum')?.value?.trim();
    const invoiceDate = document.getElementById('fInvDate')?.value;
    const dueDate     = document.getElementById('fInvDue')?.value;
    const amount      = parseFloat(document.getElementById('fInvAmount')?.value || '0');

    if (!invoiceNum || !amount) { this.toast('Invoice number and amount are required'); return; }

    if (supabaseClient) {
      // Resolve vendor_id by name
      const { data: vRow } = await supabaseClient
        .from('vendors').select('id').eq('name', vendorName).maybeSingle();
      const { error } = await supabaseClient.from('invoices').insert({
        vendor_id: vRow?.id || null,
        invoice_number: invoiceNum,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        amount, amount_paid: 0, status: 'open'
      });
      if (!error) {
        await loadDataFromSupabase();
        this.renderInvoices();
        this.toast('Invoice saved');
        this.closeModal();
      } else {
        console.error('Save invoice error:', error);
        this.toast('Error saving invoice');
      }
    } else {
      DATA.invoices.push({ id: 'INV' + Date.now(), vendor: vendorName, invoiceNum, date: invoiceDate, due: dueDate, amount, paid: 0, status: 'open' });
      this.renderInvoices();
      this.toast('Invoice added (local only)');
      this.closeModal();
    }
  },

  async saveJournal() {
    const accDate  = document.getElementById('fJeDate')?.value;
    const entity   = document.getElementById('fJeEntity')?.value;
    const memo     = document.getElementById('fJeMemo')?.value?.trim();
    const acc1     = document.getElementById('fJeAcc1')?.value?.trim();
    const debit1   = parseFloat(document.getElementById('fJeDebit1')?.value || '0');
    const credit1  = parseFloat(document.getElementById('fJeCredit1')?.value || '0');
    const acc2     = document.getElementById('fJeAcc2')?.value?.trim();
    const debit2   = parseFloat(document.getElementById('fJeDebit2')?.value || '0');
    const credit2  = parseFloat(document.getElementById('fJeCredit2')?.value || '0');
    const entryType = document.getElementById('fJeType')?.value;

    if (!memo) { this.toast('Memo is required'); return; }
    const totalDeb = debit1 + debit2, totalCred = credit1 + credit2;
    if (totalDeb > 0 && Math.abs(totalDeb - totalCred) > 0.01) {
      this.toast(`Debits (${fmt(totalDeb)}) must equal credits (${fmt(totalCred)})`);
      return;
    }
    const entityCode = entity === 'WB (consolidated)' ? 'WB' : entity;

    if (supabaseClient) {
      const entityId = window._entityByCode[entityCode] || null;

      // Find account IDs by code or name
      const findAccountId = async (query) => {
        if (!query) return null;
        const { data } = await supabaseClient.from('accounts')
          .select('id')
          .or(`account_code.eq.${query},account_name.ilike.%${query}%`)
          .limit(1);
        return data?.[0]?.id || null;
      };
      const [acc1Id, acc2Id] = await Promise.all([findAccountId(acc1), findAccountId(acc2)]);

      const { data: je, error: jeErr } = await supabaseClient
        .from('journal_entries')
        .insert({
          entity_id: entityId,
          transaction_date: accDate,
          accounting_date: accDate,
          description: memo,
          entry_type: entryType || 'manual',
          source: 'MANUAL',
          status: 'POSTED'
        })
        .select('id')
        .single();

      if (!jeErr && je?.id) {
        const lines = [];
        if (acc1 && (debit1 > 0 || credit1 > 0)) {
          lines.push({ journal_entry_id: je.id, account_id: acc1Id, entity_id: entityId, debit_amount: debit1, credit_amount: credit1, memo });
        }
        if (acc2 && (debit2 > 0 || credit2 > 0)) {
          lines.push({ journal_entry_id: je.id, account_id: acc2Id, entity_id: entityId, debit_amount: debit2, credit_amount: credit2, memo });
        }
        if (lines.length > 0) await supabaseClient.from('ledger_entries').insert(lines);
        await loadDataFromSupabase();
        this.renderJournals();
        this.toast('Journal entry posted');
        this.closeModal();
      } else {
        console.error('Journal save error:', jeErr);
        this.toast('Error posting journal');
      }
    } else {
      const jeId = 'JE-' + Date.now().toString().slice(-6);
      if (acc1) DATA.journals.push({ id: jeId, memo, account: acc1, debit: debit1, credit: credit1, date: accDate, entity: entityCode, type: entryType });
      if (acc2) DATA.journals.push({ id: jeId, memo, account: acc2, debit: debit2, credit: credit2, date: accDate, entity: entityCode, type: entryType });
      this.renderJournals();
      this.toast('Journal posted (local only)');
      this.closeModal();
    }
  },

  exportCSV() {
    const rows = state.filteredTxns.length ? state.filteredTxns : this.getActiveTxns();
    const headers = ['ID','Entity','Date','Description','Vendor','Type','Category','Amount','Status'];
    const csv = [headers, ...rows.map(t => [
      t.id, t.entity, t.accDate, `"${t.desc}"`, `"${t.vendor}"`,
      t.type, `"${t.category}"`, t.amount, t.status
    ])].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wb-transactions-${state.globalPeriodRange.from.slice(0,7)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.toast('CSV downloaded');
  },
  // ---- CSV / XLS / XLSX IMPORT ----
  handleCSVFile(input) {
    const file = input.files[0];
    if (!file) return;
    this.readSpreadsheetFile(file, (headers, rows) => {
      this._csvImportData = { headers, rows };
      this.renderCSVMappingUI(headers, rows);
    });
  },

  readSpreadsheetFile(file, callback) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        if (raw.length < 2) { this.toast('File appears empty or has no data rows'); return; }

        // Detect BAI/record-type coded bank files (H=header, D=detail, T=trailer rows)
        const firstCols = raw.slice(0, Math.min(20, raw.length)).map(r => String(r[0] || '').trim());
        const fcSet = new Set(firstCols);
        if (fcSet.has('D') && (fcSet.has('H') || fcSet.has('T'))) {
          // Fixed record-type format: keep only D rows, generate positional headers
          const dRows = raw.filter(r => String(r[0] || '').trim() === 'D');
          const maxCols = Math.max(...dRows.map(r => r.length));
          const syntheticHeaders = Array.from({length: maxCols}, (_, i) => `Col_${i + 1}`);
          callback(syntheticHeaders, dRows.map(r => r.map(v => String(v ?? ''))));
          return;
        }

        // Standard format: auto-detect header row by keyword scoring
        const headerKws = ['date','amount','debit','credit','description','desc','memo','account','balance','status','type','check','payee','vendor','category','reference'];
        const scoreRow = r => r.filter(c => { const k = String(c).toLowerCase().replace(/[^a-z]/g,''); return headerKws.some(kw => k.includes(kw)); }).length;
        let headerRowIdx = 0;
        for (let i = 1; i < Math.min(5, raw.length); i++) {
          if (scoreRow(raw[i]) > scoreRow(raw[headerRowIdx])) headerRowIdx = i;
        }
        const headers = raw[headerRowIdx].map(String);
        const rows = raw.slice(headerRowIdx + 1)
          .filter(r => r.some(c => String(c).trim() !== ''))
          .map(r => r.map(v => String(v ?? '')));
        callback(headers, rows);
      } catch (err) {
        console.error('File parse error:', err);
        this.toast('Could not read file — ensure it is a valid CSV, XLS, or XLSX');
      }
    };
    reader.readAsArrayBuffer(file);
  },

  openImportModal(type = 'bank') {
    this._importType = type;
    this.resetImportModal();
    const titleEl = document.querySelector('#importModal .import-title');
    if (titleEl) titleEl.textContent = type === 'cc' ? 'Import Credit Card Statement' : 'Import Bank Statement';
    document.getElementById('importModal').showModal();
  },

  resetImportModal() {
    document.getElementById('importStep1').style.display = '';
    document.getElementById('importStep2').style.display = 'none';
    document.getElementById('importStep3').style.display = 'none';
    const fi = document.getElementById('importFileInput');
    if (fi) fi.value = '';
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
    // Reuse existing readSpreadsheetFile() — handles .xlsx and .csv via SheetJS
    this.readSpreadsheetFile(file, (headers, rows) => {
      this._importData = { headers, rows };
      this._renderImportStep2(headers, rows);
    });
  },

  _renderImportStep2(headers, rows) {
    if (!headers || headers.length === 0) {
      document.getElementById('importStep1').style.display = '';
      this.showToast('Could not read file headers — check the file format', 'error');
      return;
    }
    const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    document.getElementById('importStep1').style.display = 'none';
    document.getElementById('importStep2').style.display = '';

    const isCCImport = this._importType === 'cc';
    const SKIP_OPT = `<option value="-1">(skip)</option>`;

    // Auto-detect column indices — first try header keywords, then fall back to data content
    const detect = (keywords) => {
      const idx = headers.findIndex(h => keywords.some(k => h.toLowerCase().replace(/[^a-z]/g,'').includes(k)));
      return idx >= 0 ? idx : -1;
    };
    // Data-based detection: scan first 5 data rows for patterns
    const sampleRows = rows.slice(0, 5);
    const detectFromData = (testFn) => {
      for (let col = 0; col < (sampleRows[0]||[]).length; col++) {
        if (sampleRows.every(r => testFn(r[col] || ''))) return col;
      }
      return -1;
    };
    let guesses = {
      date:        detect(['date','dt']),
      description: detect(['description','desc','memo','narration','detail']),
      amount:      detect(['amount','amt']),
      type:        detect(['type','transtype','trantype','txntype']),
      entity:      detect(['entity','company','card']),
    };
    // BAI/non-standard format: if header detection fails, detect from data content
    if (guesses.date < 0) {
      guesses.date = detectFromData(v => /^\d{8}$/.test(v.trim()) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v.trim()));
    }
    if (guesses.amount < 0) {
      guesses.amount = detectFromData(v => /^[\d,]+\.\d{2}$/.test(v.trim().replace(/[$]/g,'')));
    }
    if (guesses.type < 0) {
      guesses.type = detectFromData(v => /credit|debit|deposit|check|wire|transfer/i.test(v));
    }
    if (guesses.entity < 0) {
      // Look for column with known entity keywords (BAND PROMO, LANYARD PROMO, etc.)
      guesses.entity = detectFromData(v => /promo|brands|koolers|lanyard|band |wb |one op|sp brand/i.test(v));
    }
    if (guesses.description < 0) {
      // Longest average text column that isn't already assigned
      const assigned = new Set(Object.values(guesses).filter(v => v >= 0));
      let maxLen = 0, descCol = -1;
      for (let col = 0; col < (sampleRows[0]||[]).length; col++) {
        if (assigned.has(col)) continue;
        const avgLen = sampleRows.reduce((s,r) => s + (r[col]||'').length, 0) / sampleRows.length;
        if (avgLen > maxLen) { maxLen = avgLen; descCol = col; }
      }
      if (descCol >= 0 && maxLen > 15) guesses.description = descCol;
    }

    // Column mapping UI
    const FIELDS = [
      { key:'date',        label:'Date *',               required:true  },
      { key:'description', label:'Description *',        required:true  },
      { key:'amount',      label:'Amount',               required:false },
      { key:'type',        label:'Type (Credit/Debit)',  required:false },
      { key:'entity',      label:'Entity (per-row)',      required:false },
    ];

    const mappingUI = document.getElementById('importMappingUI');
    mappingUI.innerHTML = `
      <div style="margin-bottom:10px;padding:8px 10px;background:var(--surface2);border-radius:6px;font-size:11px;color:var(--text2)">
        Map <b>Amount</b> and <b>Type</b> (Credit/Debit) columns. Type is needed when amounts are always positive.
      </div>
      ${FIELDS.map(f => {
        const gi = guesses[f.key];
        const opts = SKIP_OPT + headers.map((h,i) => `<option value="${i}"${i===gi?' selected':''}>${esc(h)}</option>`).join('');
        const detected = gi >= 0 ? '<span style="color:var(--green);font-size:10px">✓ detected</span>' : '';
        return `<div class="import-mapping-row" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="width:150px;font-size:12px">${f.label}</span>
          <select id="map_${f.key}" class="import-map-sel filter-select" style="flex:1;font-size:12px">${opts}</select>
          ${detected}
        </div>`;
      }).join('')}
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text3)">
          Default Entity ${isCCImport ? '<span style="color:var(--red)">*</span>' : ''}
        </label>
        <select id="importEntitySelect" class="filter-select" style="width:100%;margin-top:6px;font-size:12px">
          <option value="">— ${isCCImport ? 'Select entity (required)' : 'Auto-detect / skip'} —</option>
          ${(isCCImport ? ['LP','BP','SP1'] : ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS','SP1'])
            .map(e => `<option value="${e}" ${(state.globalEntity && state.globalEntity !== 'all' && e === state.globalEntity.toUpperCase()) ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">Used when no per-row entity column is mapped</div>
      </div>`;

    // Preview table (first 5 rows)
    const preview = document.getElementById('importPreviewTable');
    const sample = rows.slice(0, 5);
    preview.innerHTML = `
      <thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${sample.map(r=>`<tr>${r.map(c=>`<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  },

  async submitImport() {
    if (!this._importData) return;
    const { rows } = this._importData;
    const mapping = {};
    ['date','description','amount','type','entity'].forEach(f => {
      const sel = document.getElementById(`map_${f}`);
      if (sel) mapping[f] = parseInt(sel.value, 10);
    });

    let globalEntityCode = document.getElementById('importEntitySelect')?.value || '';
    // Fallback: use global entity filter if nothing selected
    if (!globalEntityCode && state.globalEntity && state.globalEntity !== 'all') {
      globalEntityCode = state.globalEntity.toUpperCase();
    }
    if (this._importType === 'cc' && !globalEntityCode) {
      this.showToast('Select an entity (LP, BP, or SP1) before importing', 'error');
      document.getElementById('importEntitySelect')?.focus();
      return;
    }
    if (mapping.amount < 0) {
      this.showToast('Map the Amount column', 'error'); return;
    }

    // Direction map for BAI transaction type codes
    const TX_DIR_MAP = {
      'CHECK PAID': 'DEBIT', 'DEPOSIT CORRECTION DB': 'DEBIT', 'MISCELLANEOUS FEES': 'DEBIT',
      'RETURNED CASH ITEM DEBIT': 'DEBIT', 'ACH OFFSET DEBIT': 'DEBIT', 'ADJUSTMENT DEBIT': 'DEBIT',
      'REGULAR DEPOSIT': 'CREDIT', 'WIRE TRANSFER CREDIT': 'CREDIT', 'ELECTRONIC TRANSFER CREDIT': 'CREDIT',
    };

    let skipped = 0;
    const records = [];
    rows.forEach(row => {
      const rawDate = row[mapping.date]?.replace(/"/g,'').trim();
      const accDate = this.normalizeDate(rawDate);
      const desc    = row[mapping.description]?.replace(/"/g,'').trim() || '';
      if (!accDate || !desc) { skipped++; return; }

      const rawAmt = (row[mapping.amount] || '').replace(/[$,"\s]/g,'');
      const val = parseFloat(rawAmt);
      if (isNaN(val) || val === 0) { skipped++; return; }
      const amount = Math.abs(val);

      // Determine direction: Type column first, then amount sign fallback
      let direction;
      if (mapping.type >= 0) {
        const typeStr = (row[mapping.type] || '').toUpperCase().trim();
        if (TX_DIR_MAP[typeStr]) direction = TX_DIR_MAP[typeStr];
        else if (typeStr.includes('CREDIT') || typeStr.includes('DEPOSIT')) direction = 'CREDIT';
        else if (typeStr.includes('DEBIT') || typeStr.includes('CHECK') || typeStr.includes('WIRE TRANSFER DEBIT')) direction = 'DEBIT';
      }
      if (!direction) {
        direction = this._importType === 'cc'
          ? (val >= 0 ? 'DEBIT' : 'CREDIT')
          : (val < 0 ? 'DEBIT' : 'CREDIT');
      }

      // Entity resolution: raw value → exact code match → keyword match → global fallback
      const rawEntityVal = mapping.entity >= 0
        ? (row[mapping.entity] || '').replace(/"/g,'').trim() : '';
      const rawEntityUpper = rawEntityVal.toUpperCase();
      let entityCode = rawEntityUpper || globalEntityCode.toUpperCase();
      // If not a direct code match, try keyword matching (e.g., "BAND PROMO LLC" → "BP")
      let entityId = entityCode ? (window._entityByCode[entityCode] || null) : null;
      if (!entityId && rawEntityVal) {
        entityCode = detectEntityFromBankAccount(rawEntityVal) || globalEntityCode.toUpperCase();
        entityId = entityCode ? (window._entityByCode[entityCode] || null) : null;
      }
      if (!entityId && globalEntityCode) {
        entityId = window._entityByCode[globalEntityCode.toUpperCase()] || null;
      }

      records.push({
        description: desc,
        amount,
        direction,
        transaction_date: accDate,
        accounting_date:  accDate,
        source:     this._importType === 'cc' ? 'credit_card' : 'csv',
        classified: false,
        entity_id:  entityId,
      });
    });

    if (!records.length) {
      document.getElementById('importStep2').style.display = 'none';
      document.getElementById('importStep3').style.display = '';
      document.getElementById('importResult').innerHTML = `<p style="color:var(--red)">No valid rows found. ${skipped} rows skipped — check date and amount columns.</p>`;
      return;
    }

    document.getElementById('importStep2').style.display = 'none';
    document.getElementById('importStep3').style.display = '';
    document.getElementById('importResult').innerHTML = '<p>Importing…</p>';

    const { error } = await supabaseClient.from('raw_transactions').insert(records);

    if (error) {
      document.getElementById('importResult').innerHTML = `<p style="color:var(--red)">Error: ${error.message}</p>`;
    } else {
      document.getElementById('importResult').innerHTML = `<p style="color:var(--green)">✓ Imported ${records.length} transaction${records.length!==1?'s':''}${skipped?` (${skipped} skipped)`:''}.</p>`;
      this.showToast(`${records.length} transactions imported`, 'success');
    }
  },

  autoDetectCSVColumns(headers, rows) {
    const map = {};
    const n = s => s.toLowerCase().replace(/[^a-z]/g, '');
    headers.forEach((h, i) => {
      const k = n(h);
      if (['accdate','accountingdate','acctdate'].includes(k) || (k.includes('account') && k.includes('date'))) map.accDate = i;
      if (map.accDate === undefined && k.includes('date')) map.accDate = i;
      if (['entity','company'].includes(k)) map.entity = i;
      if (['description','desc','memo','narrative','details','reference'].includes(k)) map.desc = i;
      if (['vendor','payee','merchant','supplier'].includes(k)) map.vendor = i;
      if (['type','transactiontype','txntype','kind'].includes(k)) map.type = i;
      if (['category','categories','cat'].includes(k)) map.category = i;
      if (['amount','value','sum','total'].includes(k)) map.amount = i;
      if (['debit','dr','debits','debitamount'].includes(k)) map.debit = i;
      if (['credit','cr','credits','creditamount'].includes(k)) map.credit = i;
      if (['status','state'].includes(k)) map.status = i;
      if (['bankaccount','accountname','acctname'].includes(k) ||
          (k.includes('account') && k.includes('name'))) map.bankAccount = i;
      if (['accountnumber','accountno','acctno','accountnum','acctnum','account'].includes(k) ||
          (k.includes('account') && (k.includes('number') || k.includes('num') || k.includes('no')))) map.accountNumber = i;
      // AMEX CC columns
      if (['receipt'].includes(k)) map.memo = map.memo ?? i;
      if (k.includes('cardmember') || k === 'cardno' || k === 'cardholder') map.entity = map.entity ?? i;
    });

    // Value-based detection for synthetic headers (Col_1, Col_2 …) from record-type bank files
    if (headers.every(h => /^Col_\d+$/.test(h)) && rows && rows.length > 0) {
      const samples = rows.slice(0, Math.min(5, rows.length));
      // Pass 1: detect date, amount, type, bankAccount first
      headers.forEach((h, i) => {
        const vals = samples.map(r => String(r[i] || '').trim());
        const first = vals[0];
        if (map.accDate === undefined && vals.every(v => /^\d{8}$/.test(v))) map.accDate = i;
        if (map.amount === undefined && vals.every(v => /^\d+\.\d{2}$/.test(v)) && parseFloat(first) > 0) map.amount = i;
        if (map.type === undefined && vals.some(v => /\b(CREDIT|DEBIT)\b/i.test(v))) map.type = i;
        if (map.bankAccount === undefined && /\b(LLC|INC|CORP|CO\.|LTD|MANAGEMENT|PROMO|BRANDS)\b/i.test(first)) map.bankAccount = i;
        if (map.accountNumber === undefined && vals.every(v => /^\d{6,18}$/.test(v))) map.accountNumber = i;
      });
      // Pass 2: detect description — skip columns already assigned
      const assigned = new Set(Object.values(map));
      headers.forEach((h, i) => {
        if (assigned.has(i)) return;
        const vals = samples.map(r => String(r[i] || '').trim());
        const first = vals[0];
        if (map.desc === undefined && first.length > 10 && /[A-Za-z].*[A-Za-z]/.test(first) &&
            !/^\d{8}$/.test(first) && !/^0+$/.test(first)) map.desc = i;
      });
    }
    return map;
  },

  renderCSVMappingUI(headers, rows) {
    const fields = [
      { key: 'accDate',     label: 'Date',         required: true  },
      { key: 'entity',      label: 'Entity',        required: false },
      { key: 'desc',        label: 'Description',   required: true  },
      { key: 'bankAccount',   label: 'Bank Account',   required: false },
      { key: 'accountNumber', label: 'Account Number', required: false },
      { key: 'vendor',      label: 'Vendor',        required: false },
      { key: 'type',        label: 'Type',          required: false },
      { key: 'category',    label: 'Category',      required: false },
      { key: 'amount',      label: 'Amount',        required: false },
      { key: 'status',      label: 'Status',        required: false },
    ];
    const autoMap = this.autoDetectCSVColumns(headers, rows);
    const mappingHTML = fields.map(f => `
      <div class="csv-map-row">
        <div class="csv-map-label">${f.label}${f.required ? '<span style="color:var(--red);margin-left:2px">*</span>' : ''}</div>
        <select class="filter-select csv-map-select" data-field="${f.key}" style="flex:1;font-size:12px">
          <option value="-1">(skip)</option>
          ${headers.map((h, i) => `<option value="${i}"${autoMap[f.key] === i ? ' selected' : ''}>${h}</option>`).join('')}
        </select>
        <div class="csv-detected">${autoMap[f.key] !== undefined ? '✓ detected' : ''}</div>
      </div>`).join('');

    const previewRows = rows.slice(0, 5).map(row =>
      `<tr>${row.map(cell => `<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${cell}</td>`).join('')}</tr>`
    ).join('');

    const preEntity = this._csvImportEntity ||
      (state.globalEntity && state.globalEntity !== 'all' ? state.globalEntity.toUpperCase() : '');
    const isCCImport = this._importType === 'cc';
    const ccCodes = ['LP','BP','SP1'];
    const allCodes = ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS','SP1'];
    const entityCodes = isCCImport ? ccCodes : allCodes;
    const blankOpt = `<option value="">— Select entity ${isCCImport ? '(required)' : ''}—</option>`;
    const entityOptions = blankOpt + entityCodes.map(e =>
      `<option value="${e}" ${e === preEntity ? 'selected' : ''}>${e}</option>`).join('');

    document.getElementById('modalBody').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;color:var(--text)">${rows.length} rows detected</div>
        <button class="btn-outline btn-sm" onclick="app.openModal('importCSV')" style="font-size:11px">← Change file</button>
      </div>
      <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:8px">Entity <span style="color:var(--red)">*</span></div>
        <select id="csvEntitySelect" class="filter-select" style="width:100%;margin-bottom:14px">
          ${entityOptions}
        </select>
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:6px">Column mapping</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:10px">Map <b>Amount</b> to a single signed column (negative = debit/expense, positive = credit/income).</div>
        ${mappingHTML}
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:8px">Preview — first 5 rows</div>
        <div class="table-wrap" style="max-height:140px;overflow-y:auto">
          <table class="data-table">
            <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>${previewRows}</tbody>
          </table>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="app.executeCSVImport()">Import ${rows.length} transactions</button>
      </div>`;
  },

  async executeCSVImport() {
    const selects = document.querySelectorAll('.csv-map-select');
    const mapping = {};
    selects.forEach(s => { mapping[s.dataset.field] = parseInt(s.value); });

    const csvEntity = document.getElementById('csvEntitySelect')?.value || '';
    if (this._importType === 'cc' && !csvEntity) {
      this.showToast('Select an entity (LP, BP, or SP1) before importing', 'error');
      document.getElementById('csvEntitySelect')?.focus();
      return;
    }
    if (mapping.accDate < 0)  { this.toast('Date column is required');        return; }
    if (mapping.desc < 0)     { this.toast('Description column is required'); return; }
    if (mapping.amount < 0) {
      this.toast('Map the Amount column'); return;
    }

    const { rows } = this._csvImportData;
    const inserts = [];
    let skipped = 0;

    const TX_DIRECTION_MAP = {
      'CHECK PAID':               'DEBIT',
      'DEPOSIT CORRECTION DB':    'DEBIT',
      'MISCELLANEOUS FEES':       'DEBIT',
      'RETURNED CASH ITEM DEBIT': 'DEBIT',
      'ACH OFFSET DEBIT':         'DEBIT',
      'ADJUSTMENT DEBIT':         'DEBIT',
      'REGULAR DEPOSIT':          'CREDIT',
    };

    rows.forEach(row => {
      const accDate = this.normalizeDate(row[mapping.accDate]?.replace(/"/g, '').trim());
      // Clean description: strip trailing \EFFDAT and normalize whitespace
      const desc = row[mapping.desc]?.replace(/"/g, '').replace(/\s*\\EFFDAT\s*$/i, '').trim();

      let amount, direction;
      const rawAmt = row[mapping.amount]?.replace(/["$,\s]/g, '');
      const val = parseFloat(rawAmt);
      amount = Math.abs(val);
      // Use type column to determine direction if available (e.g. "ACH CREDIT", "MISCELLANEOUS DEBIT")
      if (mapping.type >= 0) {
        const typeStr = (row[mapping.type] || '').toUpperCase().trim();
        if (TX_DIRECTION_MAP[typeStr]) direction = TX_DIRECTION_MAP[typeStr];
        else if (typeStr.includes('CREDIT')) direction = 'CREDIT';
        else if (typeStr.includes('DEBIT'))  direction = 'DEBIT';
      }
      // Fallback: use sign of amount (negative = debit/expense; positive = credit/income)
      // For CC: positive charge = DEBIT; for bank: negative = DEBIT (expense/withdrawal)
      if (!direction) direction = this._importType === 'cc'
        ? (val >= 0 ? 'DEBIT' : 'CREDIT')
        : (val < 0 ? 'DEBIT' : 'CREDIT');

      if (!accDate || !desc || isNaN(amount) || amount === 0) { skipped++; return; }

      const bankAcct    = mapping.bankAccount   >= 0 ? row[mapping.bankAccount]?.replace(/"/g,'').trim()   || null : null;
      const acctNum     = mapping.accountNumber >= 0 ? row[mapping.accountNumber]?.replace(/"/g,'').trim() || null : null;
      const rowEntity   = mapping.entity >= 0 ? row[mapping.entity]?.replace(/"/g,'').trim().toUpperCase() || null : null;
      const entityCode  = rowEntity || detectEntityFromBankAccount(bankAcct) || csvEntity || null;
      inserts.push({
        description:      desc,
        amount,
        direction,
        transaction_date: accDate,
        accounting_date:  accDate,
        source:           this._importType === 'cc' ? 'credit_card' : 'csv',
        classified:       false,
        entity_id:        entityCode ? (window._entityByCode[entityCode] || null) : null,
        bank_account:     bankAcct,
        account_number:   acctNum
      });
    });

    if (!inserts.length) { this.toast('No valid rows to import'); return; }

    const { error } = await supabaseClient.from('raw_transactions').insert(inserts);
    if (error) { this.toast('Import failed — see console'); console.error(error); return; }

    this.closeModal();
    this.toast(`${inserts.length} transaction${inserts.length !== 1 ? 's' : ''} imported${skipped ? `, ${skipped} skipped` : ''}`);
    await this.navigate(this._importType === 'cc' ? 'cc-inbox' : 'inbox');
  },

  printReport() { window.print(); },

  // ---- CLOSE MONTH WORKFLOW ----
  async openCloseMonth() {
    const period = state.globalPeriodRange.from.slice(0,7);
    const periodLabel = this.getPeriodLabel(state.globalPeriod);
    const { data: txns, error } = await supabaseClient
      .from('transactions')
      .select('amount, accounts(account_type, account_subtype)')
      .gte('acc_date', state.globalPeriodRange.from)
      .lte('acc_date', state.globalPeriodRange.to);
    if (error) { this.toast('Failed to load period data'); return; }

    const rows = txns || [];
    const sum = (fn) => rows.filter(fn).reduce((s, t) => s + Number(t.amount), 0);
    const cashRevenue  = sum(t => t.accounts?.account_type === 'revenue');
    const cashCogs     = Math.abs(sum(t => t.accounts?.account_subtype === 'cogs'));
    const cashExpenses = Math.abs(sum(t => t.accounts?.account_type === 'expense'));

    this._closeMonthData = { period, periodLabel, cashRevenue, cashCogs, cashExpenses };

    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = `Close Month: ${periodLabel}`;
    document.getElementById('modalBody').innerHTML = `
      <h4 style="margin:0 0 4px">Step 1 of 3 — Cash Basis Summary</h4>
      <p style="color:var(--text3);font-size:13px;margin-bottom:16px">These amounts come from your classified transactions and are fixed.</p>
      <table class="data-table" style="margin-bottom:16px">
        <tr><td>Cash Revenue received</td><td style="text-align:right">${fmt(cashRevenue)}</td></tr>
        <tr><td>Cash COGS paid</td><td style="text-align:right">(${fmt(cashCogs)})</td></tr>
        <tr><td>Cash Expenses paid</td><td style="text-align:right">(${fmt(cashExpenses)})</td></tr>
        <tr style="font-weight:600"><td>Cash Net Income</td><td style="text-align:right">${fmt(cashRevenue - cashCogs - cashExpenses)}</td></tr>
      </table>
      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="app.closeMonthStep2()">Next: Accrual Entry →</button>
      </div>
    `;
    overlay.classList.add('open');
  },

  async closeMonthStep2() {
    const { period, periodLabel, cashRevenue, cashCogs } = this._closeMonthData;
    const { data: accrualJEs } = await supabaseClient
      .from('journal_entries')
      .select('ledger_entries(debit_amount, credit_amount, accounts(account_type, account_subtype))')
      .eq('period', period).eq('entry_type', 'accrual');

    let existingRev = 0, existingCogs = 0;
    (accrualJEs || []).forEach(je => {
      (je.ledger_entries || []).forEach(l => {
        const net = Number(l.credit_amount || 0) - Number(l.debit_amount || 0);
        if (l.accounts?.account_type === 'revenue') existingRev += net;
        if (l.accounts?.account_subtype === 'cogs')  existingCogs += Math.abs(net);
      });
    });
    const prefillRev  = existingRev  > 0 ? existingRev  : cashRevenue;
    const prefillCogs = existingCogs > 0 ? existingCogs : cashCogs;

    document.getElementById('modalTitle').textContent = `Close Month: ${periodLabel}`;
    document.getElementById('modalBody').innerHTML = `
      <h4 style="margin:0 0 4px">Step 2 of 3 — Accrual Amounts</h4>
      <p style="color:var(--text3);font-size:13px;margin-bottom:16px">Enter what was earned/owed this period, not just what was paid.${existingRev > 0 ? ' <strong>Pre-filled from existing accrual entries.</strong>' : ''}</p>
      <div style="display:grid;gap:12px;margin-bottom:16px">
        <div class="form-group">
          <label>Accrual Revenue (earned this period)</label>
          <input type="number" id="fAccrualRevenue" value="${prefillRev.toFixed(2)}" step="0.01" style="width:100%">
          <small style="color:var(--text3)">Cash received: ${fmt(cashRevenue)}</small>
        </div>
        <div class="form-group">
          <label>Accrual COGS (cost of goods for period)</label>
          <input type="number" id="fAccrualCogs" value="${prefillCogs.toFixed(2)}" step="0.01" style="width:100%">
          <small style="color:var(--text3)">Cash paid: ${fmt(cashCogs)}</small>
        </div>
        <div class="form-group">
          <label>Memo / notes</label>
          <input type="text" id="fAccrualMemo" placeholder="e.g. Accrual close ${periodLabel}" style="width:100%">
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-outline" onclick="app.openCloseMonth()">← Back</button>
        <button class="btn-primary" onclick="app.closeMonthStep3()">Next: Review →</button>
      </div>
    `;
  },

  closeMonthStep3() {
    const accrualRevenue = parseFloat(document.getElementById('fAccrualRevenue')?.value) || 0;
    const accrualCogs    = parseFloat(document.getElementById('fAccrualCogs')?.value)    || 0;
    const memo           = document.getElementById('fAccrualMemo')?.value?.trim() || '';
    const { cashRevenue, cashCogs, cashExpenses, periodLabel } = this._closeMonthData;

    const revenueAdj = accrualRevenue - cashRevenue;
    const cogsAdj    = accrualCogs    - cashCogs;
    const netAdj     = revenueAdj - cogsAdj;
    this._adjustingEntry = { accrualRevenue, accrualCogs, revenueAdj, cogsAdj, netAdj, memo };

    const adjRow = (label, val) => `
      <tr><td>${label}</td>
      <td style="text-align:right;color:${val >= 0 ? 'var(--green,#16a34a)' : 'var(--red)'};font-weight:500">
        ${val >= 0 ? fmt(val) : '(' + fmt(Math.abs(val)) + ')'}
      </td></tr>`;
    const cashNet  = cashRevenue - cashCogs - cashExpenses;
    const accrualNet = cashNet + netAdj;

    document.getElementById('modalTitle').textContent = `Close Month: ${periodLabel}`;
    document.getElementById('modalBody').innerHTML = `
      <h4 style="margin:0 0 4px">Step 3 of 3 — Confirm Adjusting Entry</h4>
      <p style="color:var(--text3);font-size:13px;margin-bottom:12px">This adjusting entry will be posted and the period will be locked.</p>
      <table class="data-table" style="margin-bottom:12px">
        <thead><tr><th>Line</th><th style="text-align:right">Adjustment</th></tr></thead>
        <tbody>
          ${adjRow('Revenue adjustment (accrual − cash)', revenueAdj)}
          ${adjRow('COGS adjustment (accrual − cash)', -cogsAdj)}
          ${adjRow('Net adjusting entry', netAdj)}
        </tbody>
      </table>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px">
        <table style="width:100%">
          <tr><td style="color:var(--text3)">Cash net income</td><td style="text-align:right">${fmt(cashNet)}</td></tr>
          <tr><td style="color:var(--text3)">Adjusting entry</td><td style="text-align:right">${netAdj >= 0 ? fmt(netAdj) : '(' + fmt(Math.abs(netAdj)) + ')'}</td></tr>
          <tr style="font-weight:600;border-top:1px solid var(--border)"><td>Accrual net income</td><td style="text-align:right">${fmt(accrualNet)}</td></tr>
        </table>
      </div>
      ${memo ? `<p style="color:var(--text3);font-size:13px;margin-bottom:10px">Memo: ${memo}</p>` : ''}
      <p style="font-size:13px;color:var(--red);margin-bottom:14px">⚠ This will lock ${periodLabel}. No new transactions can be classified into this period after close.</p>
      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeMonthStep2()">← Back</button>
        <button class="btn-primary" onclick="app.confirmMonthClose()">Confirm & Close Month</button>
      </div>
    `;
  },

  async confirmMonthClose() {
    const { period, periodLabel } = this._closeMonthData;
    const { revenueAdj, cogsAdj, netAdj, memo } = this._adjustingEntry;

    if (Math.abs(revenueAdj) < 0.01 && Math.abs(cogsAdj) < 0.01) {
      await supabaseClient.from('closed_periods').insert({ period, entity: state.globalEntity, closed_by: 'user' });
      this.toast(`${periodLabel} closed (no adjustments needed) ✓`);
      this.closeModal();
      await this.renderJournals();
      return;
    }

    const [{ data: revAccts }, { data: cogsAccts }] = await Promise.all([
      supabaseClient.from('accounts').select('id').eq('account_type', 'revenue').limit(1),
      supabaseClient.from('accounts').select('id').eq('account_subtype', 'cogs').limit(1)
    ]);
    const revenueAcct = (revAccts || [])[0];
    const cogsAcct    = (cogsAccts || [])[0];
    if (!revenueAcct || !cogsAcct) { this.toast('Could not find revenue or COGS accounts — check Chart of Accounts'); return; }

    const [yr, mo] = period.split('-').map(Number);
    const lastDay    = new Date(yr, mo, 0).getDate();
    const closingDate = `${period}-${String(lastDay).padStart(2, '0')}`;
    const entityId    = state.globalEntity !== 'all' ? window._entityByCode?.[state.globalEntity] : null;

    const { data: je, error: jeErr } = await supabaseClient
      .from('journal_entries')
      .insert({ description: memo || `Adjusting entry — ${periodLabel}`, accounting_date: closingDate, entry_type: 'adjusting', period, entity_id: entityId })
      .select('id').single();
    if (jeErr) { this.toast('Failed to post journal entry'); console.error(jeErr); return; }

    const lines = [];
    if (Math.abs(revenueAdj) > 0.01) lines.push({ journal_entry_id: je.id, account_id: revenueAcct.id, debit_amount: revenueAdj < 0 ? Math.abs(revenueAdj) : 0, credit_amount: revenueAdj > 0 ? revenueAdj : 0, memo: 'Revenue adjustment' });
    if (Math.abs(cogsAdj)    > 0.01) lines.push({ journal_entry_id: je.id, account_id: cogsAcct.id,    debit_amount: cogsAdj    > 0 ? cogsAdj    : 0, credit_amount: cogsAdj    < 0 ? Math.abs(cogsAdj)    : 0, memo: 'COGS adjustment' });

    if (lines.length > 0) {
      const { error: lineErr } = await supabaseClient.from('ledger_entries').insert(lines);
      if (lineErr) { this.toast('Failed to post ledger lines'); console.error(lineErr); return; }
    }

    const { error: lockErr } = await supabaseClient.from('closed_periods').insert({ period, entity: state.globalEntity, closed_by: 'user' });
    if (lockErr && lockErr.code !== '23505') { this.toast('Failed to lock period'); console.error(lockErr); return; }

    this.toast(`${periodLabel} closed ✓`);
    this.closeModal();
    await this.renderJournals();
  },

  // ---- SIDEBAR ----
  toggleSidebar() {
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebarBackdrop').classList.toggle('open');
    } else {
      document.getElementById('app').classList.toggle('sidebar-collapsed');
    }
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('open');
  },

  // ---- DASHBOARD KPIs ----
  async updateDashboardKPIs() {
    const entity = state.globalEntity;
    const period = state.globalPeriodRange?.from?.slice(0,7) || '';

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val !== null ? fmt(val) : '—';
    };

    ['m-revenue','m-income','m-gp','m-np','m-adspend'].forEach(id => set(id, 0));
    if (!supabaseClient) return;

    const data = await this.fetchReportData(entity, state.globalPeriodRange);
    if (!data) return;

    const groups    = this.groupByAccount(data.txns);
    const byType    = (type) => Object.values(groups).filter(g => g.account.account_type === type);
    const bySubtype = (sub)  => Object.values(groups).filter(g => g.account.account_subtype === sub);
    const sum       = (arr)  => arr.reduce((s, g) => s + g.total, 0);

    const revenue  = sum(byType('revenue'));
    const expenses = Math.abs(sum(byType('expense')));
    const cogs     = Math.abs(sum(bySubtype('cogs')));
    const adSpend  = Math.abs(sum(bySubtype('advertising')));
    const gp       = revenue - cogs;
    const np       = revenue - expenses;

    set('m-revenue', revenue);
    set('m-income',  cogs);       // renamed to COGS in HTML
    set('m-gp',      gp);
    set('m-np',      np);
    set('m-adspend', adSpend);

    // Margin deltas on KPI cards
    const setDelta = (elId, text, isNeg) => {
      const card = document.getElementById(elId)?.closest('.metric-card');
      const d = card?.querySelector('.metric-delta');
      if (!d) return;
      d.textContent = text;
      d.className = 'metric-delta' + (isNeg ? ' neg' : '');
    };
    if (revenue > 0) {
      setDelta('m-np',     ((np / revenue) * 100).toFixed(1) + '% margin',       np < 0);
      setDelta('m-gp',     ((gp / revenue) * 100).toFixed(1) + '% gross margin', gp < 0);
      setDelta('m-income', ((cogs / revenue) * 100).toFixed(1) + '% of revenue', false);
    }

    // Cash Runway KPI
    let bankBalance = 0;
    if (window._bankAccounts) bankBalance = window._bankAccounts.reduce((s, a) => s + a.balance, 0);
    const runwayKpi = document.getElementById('m-runway');
    if (runwayKpi && window._weeklyActuals) {
      const actualWeeks = window._weeklyActuals.filter(w => w.type === 'Actual');
      const totalOut = actualWeeks.reduce((s, w) => s + w.cogs + w.ads + w.oh + w.other, 0);
      const weeklyBurn = actualWeeks.length ? totalOut / actualWeeks.length : 0;
      const monthlyBurn = weeklyBurn * 4.33;
      const runway = monthlyBurn > 0 ? bankBalance / monthlyBurn : 0;
      runwayKpi.textContent = runway.toFixed(1) + ' mo';
      const delta = runwayKpi.closest('.metric-card')?.querySelector('.metric-delta');
      if (delta) { delta.textContent = 'Cash runway'; delta.style.color = runway >= 6 ? 'var(--green)' : runway >= 3 ? 'var(--amber)' : 'var(--red)'; }
    }

    // Net profit pulse animation
    const npCard = document.getElementById('m-np')?.closest('.metric-card');
    if (npCard) {
      npCard.classList.toggle('kpi-pulse-positive', np > 0);
      npCard.classList.toggle('kpi-pulse-negative', np < 0);
    }

    // ── Cash Position Row (navy cards) ──────────────────────────────────────
    if (window._bankAccounts) {
      const banks   = window._bankAccounts;
      const total   = banks.reduce((s, a) => s + a.balance, 0);
      const cc      = window._ccPayables || 0;
      const netCash = total - cc;
      const bankNames = [...new Set(banks.map(a => a.bank))].join(' + ');

      const cpBank = document.getElementById('cp-bank');
      const cpBankSub = document.getElementById('cp-bank-sub');
      const cpCC   = document.getElementById('cp-cc');
      const cpNet  = document.getElementById('cp-net');
      const cpNetSub = document.getElementById('cp-net-sub');

      if (cpBank) cpBank.textContent = fmt(total);
      if (cpBankSub) cpBankSub.textContent = `${banks.length} accounts · All entities · ${bankNames}`;
      if (cpCC) cpCC.textContent = fmt(cc);
      if (cpNet) {
        cpNet.textContent = (netCash < 0 ? '-' : '') + fmt(Math.abs(netCash));
        cpNet.className = 'cash-pos-val ' + (netCash >= 0 ? 'g' : 'r');
      }
      if (cpNetSub) {
        const actualWks = (window._weeklyActuals || []).filter(w => w.type === 'Actual');
        const weeklyPft = actualWks.length ? actualWks.reduce((s,w)=>s+w.sales,0)/actualWks.length : 0;
        if (netCash < 0 && weeklyPft > 0) {
          const weeksToBreakeven = Math.ceil(Math.abs(netCash) / weeklyPft);
          cpNetSub.textContent = `Clears in ~${weeksToBreakeven} weeks at current revenue pace`;
        } else {
          cpNetSub.textContent = 'Bank balance minus CC payables';
        }
      }
    }

    // ── Bank Account Table ──────────────────────────────────────────────────
    const tbody = document.getElementById('bankTableBody');
    const tfoot = document.getElementById('bankTableTotal');
    const tdate = document.getElementById('bankTableDate');
    if (tbody && window._bankAccounts) {
      const banks = window._bankAccounts;
      const total = banks.reduce((s, a) => s + a.balance, 0);
      if (tdate) tdate.textContent = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
      tbody.innerHTML = banks.map(a => {
        const chip = a.status === 'low'
          ? '<span style="background:#FEE2E2;color:#991B1B;padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:700;">Low</span>'
          : '<span style="background:#DCFCE7;color:#166534;padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:700;">Active</span>';
        return `<tr>
          <td><strong>${a.name}</strong></td>
          <td style="color:var(--text2)">${a.entity}</td>
          <td style="color:var(--text2)">${a.bank}</td>
          <td class="r" style="font-family:var(--mono);font-weight:600;color:${a.balance < 50000 ? 'var(--amber)' : 'var(--text)'}">${fmt(a.balance)}</td>
          <td>${chip}</td>
        </tr>`;
      }).join('');
      if (tfoot) tfoot.textContent = fmt(total);
    }

    // ── Enterprise Narrative Insights (2×2 grid) ───────────────────────────
    const insights = document.getElementById('insightsSection');
    if (insights) {
      if (data.txns.length === 0) {
        insights.innerHTML = '<div class="ins risk" style="grid-column:span 2"><div class="ins-title">No data for this period</div><div class="ins-text">Import transactions in the Inbox to populate this dashboard.</div></div>';
      } else {
        const gpMargin   = revenue > 0 ? (gp / revenue * 100) : 0;
        const npMargin   = revenue > 0 ? (np / revenue * 100) : 0;
        const adPct      = revenue > 0 ? (adSpend / revenue * 100) : 0;
        const overdueAmt = DATA.invoices.filter(i => i.status === 'overdue').reduce((s,i) => s + (Number(i.amount) - Number(i.amount_paid||0)), 0);
        const overdueCount = DATA.invoices.filter(i => i.status === 'overdue').length;
        const cc = window._ccPayables || 0;

        // Baseline comparison (Jan 2025 ~-1% net margin, Jan 2026 ~+11.86%)
        const baselineNPMargin = -1.0;
        const marginSwing = npMargin - baselineNPMargin;

        const cards = [];

        // Card 1 — Margin / Profitability
        if (npMargin > 8) {
          cards.push({ cls:'opp', title:'🟢 Margin Performance', text:`Net margin is <span class="ins-num">${npMargin.toFixed(1)}%</span> this period. Gross margin at <span class="ins-num">${gpMargin.toFixed(1)}%</span> — COGS efficiency holding. YoY swing: <span class="ins-num">+${marginSwing.toFixed(1)} pp</span> vs prior year baseline.` });
        } else if (npMargin > 0) {
          cards.push({ cls:'risk', title:'🟠 Margin Watch', text:`Net margin is <span class="ins-num">${npMargin.toFixed(1)}%</span> — below the 8% target. Gross margin <span class="ins-num">${gpMargin.toFixed(1)}%</span>. Review COGS and ad spend efficiency.` });
        } else {
          cards.push({ cls:'warn', title:'🔴 Net Loss This Period', text:`Net loss of <span class="ins-num">${fmt(Math.abs(np))}</span> (margin: <span class="ins-num">${npMargin.toFixed(1)}%</span>). Gross margin <span class="ins-num">${gpMargin.toFixed(1)}%</span> — review operating expenses and pricing.` });
        }

        // Card 2 — Ad Spend / ROAS
        if (adPct > 30) {
          cards.push({ cls:'warn', title:'🔴 Ad Spend Ratio High', text:`Ad spend is <span class="ins-num">${adPct.toFixed(1)}%</span> of revenue (${fmt(adSpend)}). Target is under 28%. Review ROAS by channel — Amex Lanyard carries <span class="ins-num">~$346K</span> at 18–24% APR; reducing ad-funded credit reduces interest expense.` });
        } else if (adPct > 22) {
          cards.push({ cls:'risk', title:'🟠 Ad Spend Efficiency', text:`Ad spend at <span class="ins-num">${adPct.toFixed(1)}%</span> of revenue (${fmt(adSpend)}). Approaching the 28% ceiling. Monitor ROAS weekly; redirect underperforming campaigns.` });
        } else {
          cards.push({ cls:'opp', title:'🟢 Ad Spend Controlled', text:`Ad spend at <span class="ins-num">${adPct.toFixed(1)}%</span> of revenue (${fmt(adSpend)}) — within the 28% target. Efficient ad allocation supporting margin expansion.` });
        }

        // Card 3 — CC / Cash Position
        if (cc > 300000) {
          const bankTot = (window._bankAccounts || []).reduce((s,a)=>s+a.balance,0);
          const actualWks = (window._weeklyActuals||[]).filter(w=>w.type==='Actual');
          const avgMonthlyProfit = actualWks.length ? actualWks.reduce((s,w)=>s+(w.sales-w.cogs-w.ads-w.oh),0)/actualWks.length*4.33 : 0;
          const monthsToClear = avgMonthlyProfit > 0 ? Math.ceil(cc / avgMonthlyProfit) : '?';
          cards.push({ cls:'warn', title:'🔴 CC Balance Action Needed', text:`CC payables at <span class="ins-num">${fmt(cc)}</span> at ~18–24% APR. Use current profitability (avg <span class="ins-num">${fmt(avgMonthlyProfit)}/mo</span>) to begin reducing — saves ~<span class="ins-num">${fmt(cc*0.21/12)}/mo</span> in interest. Estimated clear in ${monthsToClear} months.` });
        } else if (overdueAmt > 50000) {
          cards.push({ cls:'risk', title:'🟠 Overdue AR Alert', text:`<span class="ins-num">${overdueCount} invoice(s)</span> past due totaling <span class="ins-num">${fmt(overdueAmt)}</span>. Prioritize collection on largest balances — accelerates cash position and reduces credit reliance.` });
        } else {
          cards.push({ cls:'opp', title:'🟢 Cash Position Stable', text:`Bank balance <span class="ins-num">${fmt((window._bankAccounts||[]).reduce((s,a)=>s+a.balance,0))}</span> across ${(window._bankAccounts||[]).length} accounts. CC payables <span class="ins-num">${fmt(cc)}</span> — manageable. Net position is ${(window._bankAccounts||[]).reduce((s,a)=>s+a.balance,0) > cc ? 'positive' : 'negative'}.` });
        }

        // Card 4 — Seasonality / Revenue Trend
        const mo = parseInt((period||'').split('-')[1]||'3');
        if (mo >= 10 || mo <= 2) {
          cards.push({ cls:'risk', title:'🟠 Q4/Q1 Seasonality Risk', text:`Revenue typically falls <span class="ins-num">50–57%</span> from peak in Oct–Jan for promo products. Target <span class="ins-num">$500K+ reserve</span> by Sep to cover trough. Monitor weekly actuals vs forecast closely.` });
        } else if (mo >= 3 && mo <= 6) {
          cards.push({ cls:'opp', title:'🟢 Peak Season Ramp', text:`Q2 is the primary revenue ramp for promo products. Prioritize <span class="ins-num">lanyard and wristband inventory</span> build-up. Target gross margin above <span class="ins-num">48%</span> before Jul 4 spike.` });
        } else {
          cards.push({ cls:'opp', title:'🟢 Peak Revenue Window', text:`Jul–Sep is peak season for promo products. Maximize order capacity and pre-negotiate COGS with suppliers. Use peak profits to reduce Amex Lanyard balance (<span class="ins-num">~$346K</span>).` });
        }

        insights.innerHTML = cards.slice(0,4).map(c =>
          `<div class="ins ${c.cls}"><div class="ins-title">${c.title}</div><div class="ins-text">${c.text}</div></div>`
        ).join('');
      }
    }

    await this.updateDashboardCharts(data, entity, period);
  },

  onDashChartControl() {
    const entity = state.globalEntity;
    const period = state.globalPeriodRange.from.slice(0,7);
    this.fetchReportData(entity, state.globalPeriodRange).then(data => {
      if (data) this.updateDashboardCharts(data, entity, period);
    });
  },

  async updateDashboardCharts(data, entity, period) {
    if (!state.charts || !data) return;
    const txns = data.txns || [];

    // Read chart control dropdown values
    const periodSel = document.getElementById('dashPeriodSel')?.value || 'current';
    const metricSel = document.getElementById('dashMetricSel')?.value || 'all';
    const typeSel   = document.getElementById('dashTypeSel')?.value   || 'combo';

    // Update subtitle
    const sub = document.getElementById('dashChartSubtitle');
    const periodLabel = { current:'Current month · daily', '6':'Last 6 months · monthly', '12':'Last 12 months · monthly', ytd:'YTD 2026 · monthly' };
    if (sub) sub.textContent = (periodLabel[periodSel] || '') + (entity !== 'all' ? ` · ${entity}` : ' · All entities');

    // ── Main Revenue/Profit Chart ────────────────────────────────────────────
    if (state.charts.revenue) {
      const ch = state.charts.revenue;

      if (periodSel === 'current') {
        // Daily chart for current month
        const daysInMonth = new Date(parseInt(period.split('-')[0]), parseInt(period.split('-')[1]), 0).getDate();
        const dailyRevenue  = Array(daysInMonth).fill(0);
        const dailyExpenses = Array(daysInMonth).fill(0);
        for (const t of txns) {
          const day = parseInt((t.acc_date || '').split('-')[2] || '0') - 1;
          if (day < 0 || day >= daysInMonth) continue;
          const type = t.accounts?.account_type;
          const amt  = Number(t.amount);
          if (type === 'revenue') dailyRevenue[day] += amt;
          else if (type === 'expense') dailyExpenses[day] += Math.abs(amt);
        }
        const dailyNet = dailyRevenue.map((r, i) => r - dailyExpenses[i]);
        const labels = Array.from({length: daysInMonth}, (_, i) => String(i + 1));
        ch.data.labels = labels;
        ch.options.scales.x.stacked = false;
        ch.options.scales.y.stacked = false;

        if (metricSel === 'revenue') {
          ch.data.datasets = [{ label:'Revenue', data: dailyRevenue, backgroundColor:'rgba(30,58,138,0.7)', type:'bar', borderRadius:2, order:2 }];
        } else if (metricSel === 'profit') {
          ch.data.datasets = [{ label:'Net Profit', data: dailyNet, backgroundColor: dailyNet.map(v => v >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'), type:'bar', borderRadius:2, order:2 }];
        } else if (metricSel === 'margin') {
          const marginPct = dailyRevenue.map((r, i) => r > 0 ? +((dailyNet[i] / r * 100).toFixed(1)) : 0);
          ch.data.datasets = [{ label:'Net Margin %', data: marginPct, borderColor:'#6366F1', backgroundColor:'rgba(99,102,241,0.08)', type:'line', fill:true, tension:0.3, order:1 }];
        } else {
          ch.data.datasets = [
            { label:'Revenue',  data: dailyRevenue,  backgroundColor:'rgba(30,58,138,0.65)', type: typeSel === 'line' ? 'line' : 'bar', borderRadius:2, tension:0.3, order:2 },
            { label:'Expenses', data: dailyExpenses, backgroundColor:'rgba(13,107,116,0.45)', type: typeSel === 'line' ? 'line' : 'bar', borderRadius:2, tension:0.3, order:3 },
            { label:'Net',      data: dailyNet, borderColor:'#10B981', backgroundColor:'rgba(16,185,129,0.08)', type:'line', fill: typeSel !== 'bar', tension:0.3, order:1 },
          ];
        }
        ch.update();

      } else if (supabaseClient) {
        // Multi-month chart
        const now = new Date();
        let monthCount = 6;
        let startDate = '';
        if (periodSel === '6')   { monthCount = 6; }
        else if (periodSel === '12') { monthCount = 12; }
        else if (periodSel === 'ytd') {
          monthCount = now.getMonth() + 1;
          startDate = now.getFullYear() + '-01';
        }

        const monthLabels = [];
        const mRevArr = [], mNPArr = [], mMarginArr = [];
        const monthsToFetch = [];
        for (let i = monthCount - 1; i >= 0; i--) {
          const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthsToFetch.push(d.toISOString().slice(0, 7));
          monthLabels.push(d.toLocaleString('default', { month:'short', year:'2-digit' }));
        }

        for (const mo of monthsToFetch) {
          let q = supabaseClient.from('transactions')
            .select('amount, accounts(account_type, account_subtype)')
            .gte('acc_date', mo + '-01').lte('acc_date', mo + '-31');
          q = applyEntityFilter(q, entity);
          const { data: mTxns } = await q;
          const mRows = mTxns || [];
          const mRev = mRows.filter(t => t.accounts?.account_type === 'revenue').reduce((s,t) => s + Number(t.amount), 0);
          const mExp = mRows.filter(t => t.accounts?.account_type === 'expense').reduce((s,t) => s + Math.abs(Number(t.amount)), 0);
          const mNP  = mRev - mExp;
          mRevArr.push(Math.round(mRev));
          mNPArr.push(Math.round(mNP));
          mMarginArr.push(mRev > 0 ? +((mNP / mRev * 100).toFixed(1)) : 0);
        }

        ch.data.labels = monthLabels;
        ch.options.scales.x.stacked = false;
        ch.options.scales.y.stacked = false;
        if (metricSel === 'revenue') {
          ch.data.datasets = [{ label:'Revenue', data: mRevArr, backgroundColor:'rgba(30,58,138,0.7)', type: typeSel === 'line' ? 'line' : 'bar', tension:0.3 }];
        } else if (metricSel === 'profit') {
          ch.data.datasets = [{ label:'Net Profit', data: mNPArr, backgroundColor: mNPArr.map(v => v >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'), type: typeSel === 'line' ? 'line' : 'bar', tension:0.3 }];
        } else if (metricSel === 'margin') {
          ch.data.datasets = [{ label:'Net Margin %', data: mMarginArr, borderColor:'#6366F1', backgroundColor:'rgba(99,102,241,0.08)', type:'line', fill:true, tension:0.3 }];
        } else {
          const revType  = (typeSel === 'line') ? 'line' : 'bar';
          const profType = (typeSel === 'bar')  ? 'bar'  : 'line';
          ch.data.datasets = [
            { label:'Revenue',    data: mRevArr, backgroundColor:'rgba(30,58,138,0.65)', borderColor:'rgba(30,58,138,0.9)',  type: revType,  tension:0.3, order:2 },
            { label:'Net Profit', data: mNPArr,  borderColor:'#10B981', backgroundColor:'rgba(16,185,129,0.08)', type: profType, fill: profType === 'line', tension:0.3, order:1 },
          ];
        }
        ch.update();
      }
    }

    // ── Expense donut: by subtype ────────────────────────────────────────────
    const subtypeMap = { cogs:0, payroll:1, advertising:2, shipping:3, platform:4 };
    const expBySubtype = [0,0,0,0,0,0];
    for (const t of txns) {
      const type = t.accounts?.account_type;
      const sub  = t.accounts?.account_subtype || '';
      if (type !== 'expense') continue;
      const idx  = subtypeMap[sub] !== undefined ? subtypeMap[sub] : 5;
      expBySubtype[idx] += Math.abs(Number(t.amount));
    }
    if (state.charts.expenseDonut) {
      state.charts.expenseDonut.data.datasets[0].data = expBySubtype;
      state.charts.expenseDonut.update();
    }

    // ── Entity bar: revenue per entity for current period ────────────────────
    const entityCodes = ['LP','KP','BP','WBP','ONEOPS'];
    const entityRevenue = [0,0,0,0,0];
    if (entity === 'all' && supabaseClient) {
      const { data: entityTxns } = await supabaseClient
        .from('transactions')
        .select('entity, amount, accounts(account_type)')
        .gte('acc_date', period + '-01')
        .lte('acc_date', period + '-31');
      for (const t of (entityTxns || [])) {
        const idx = entityCodes.indexOf(t.entity);
        if (idx >= 0 && t.accounts?.account_type === 'revenue') entityRevenue[idx] += Number(t.amount);
      }
    } else {
      const idx = entityCodes.indexOf(entity);
      if (idx >= 0) entityRevenue[idx] = txns.filter(t => t.accounts?.account_type === 'revenue').reduce((s, t) => s + Number(t.amount), 0);
    }
    if (state.charts.entity) {
      state.charts.entity.data.datasets[0].data = entityRevenue;
      state.charts.entity.update();
    }

    // ── Trend chart: last 6 months net profit + ad spend ────────────────────
    if (supabaseClient) {
      const monthLabels = [];
      const trendNP     = [];
      const trendAd     = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mo  = d.toISOString().slice(0, 7);
        monthLabels.push(i === 0 ? 'This month' : (i === 1 ? 'Last month' : mo));
        let q = supabaseClient.from('transactions')
          .select('amount, accounts(account_type, account_subtype)')
          .gte('acc_date', mo + '-01').lte('acc_date', mo + '-31');
        q = applyEntityFilter(q, entity);
        const { data: mTxns } = await q;
        const mRows = mTxns || [];
        const mRev  = mRows.filter(t => t.accounts?.account_type === 'revenue').reduce((s,t) => s + Number(t.amount), 0);
        const mExp  = mRows.filter(t => t.accounts?.account_type === 'expense').reduce((s,t) => s + Math.abs(Number(t.amount)), 0);
        const mAd   = mRows.filter(t => t.accounts?.account_subtype === 'advertising').reduce((s,t) => s + Math.abs(Number(t.amount)), 0);
        trendNP.push(Math.round((mRev - mExp) / 1000 * 10) / 10);
        trendAd.push(Math.round(mAd / 1000 * 10) / 10);
      }
      if (state.charts.trend) {
        state.charts.trend.data.labels = monthLabels;
        state.charts.trend.data.datasets[0].data = trendNP;
        state.charts.trend.data.datasets[1].data = trendAd;
        state.charts.trend.update();
      }
    }

    // ── Cash-by-entity bars ─────────────────────────────────────────────────
    const cashBars = document.getElementById('cashBars');
    if (cashBars && window._bankAccounts) {
      const banks = window._bankAccounts;
      const maxBal = Math.max(...banks.map(a => a.balance), 1);
      cashBars.innerHTML = banks.map(a => {
        const pct = Math.round(a.balance / maxBal * 100);
        const color = a.balance < 50000 ? 'var(--amber)' : 'var(--accent)';
        return `<div class="cash-row">
          <div class="cash-entity">${a.entity}</div>
          <div class="cash-track"><div class="cash-fill" style="width:${pct}%;background:${color}"></div></div>
          <div class="cash-amount">${fmt(a.balance)}</div>
        </div>`;
      }).join('');
    }
  },

  // ---- INVOICE DETAIL ----
  viewInvoice(id) {
    const inv = DATA.invoices.find(i => i.id === id);
    if (inv) this.openModal('viewInvoice', inv);
  },

  // ---- ACCOUNT ----
  async _reloadCOA() {
    const { data } = await supabaseClient
      .from('accounts').select('id, account_code, account_name, account_type, account_subtype, is_elimination')
      .order('account_code');
    if (data) {
      DATA.coa = data.map(a => ({
        id: a.id, code: a.account_code, name: a.account_name,
        type: a.account_type, subtype: a.account_subtype || '',
        line: a.account_name, balance: 0, elimination: a.is_elimination || false
      }));
      data.forEach(a => { window._accountById[a.id] = a.account_name; });
    }
    this.renderCOA();
  },

  async saveAccount() {
    const code    = document.getElementById('fCoaCode')?.value?.trim();
    const name    = document.getElementById('fCoaName')?.value?.trim();
    const type    = document.getElementById('fCoaType')?.value;
    const subtype = document.getElementById('fCoaSubtype')?.value?.trim();
    const editId  = document.getElementById('fCoaEditId')?.value || null;
    if (!code || !name) { this.showToast('Code and name are required', 'error'); return; }

    if (editId) {
      const { error } = await supabaseClient.from('accounts').update({
        account_code: code, account_name: name, account_type: type,
        account_subtype: subtype || type,
        normal_balance: (type === 'asset' || type === 'expense') ? 'DEBIT' : 'CREDIT',
      }).eq('id', editId);
      if (error) { this.showToast('Update failed: ' + error.message, 'error'); return; }
      this.showToast('Account updated', 'success');
    } else {
      const { error } = await supabaseClient.from('accounts').insert({
        account_code: code, account_name: name, account_type: type,
        account_subtype: subtype || type,
        normal_balance: (type === 'asset' || type === 'expense') ? 'DEBIT' : 'CREDIT',
        is_active: true
      });
      if (error) {
        if (error.code === '23505') this.showToast('Account code already exists', 'error');
        else this.showToast('Save failed: ' + error.message, 'error');
        return;
      }
      this.showToast('Account added', 'success');
    }
    this.closeModal();
    await this._reloadCOA();
  },

  openEditAccount(id) {
    const a = DATA.coa.find(x => x.id === id);
    if (!a) return;
    const overlay = document.getElementById('modalOverlay');
    const title   = document.getElementById('modalTitle');
    const body    = document.getElementById('modalBody');
    if (!overlay || !body) return;
    if (title) title.textContent = 'Edit Account';
    body.innerHTML = `
      <input type="hidden" id="fCoaEditId" value="${a.id}"/>
      <div class="form-row">
        <div class="form-group">
          <label>Account code</label>
          <input type="text" id="fCoaCode" value="${a.code}"/>
        </div>
        <div class="form-group">
          <label>Account type</label>
          <select id="fCoaType">
            <option value="asset" ${a.type==='asset'?'selected':''}>Asset</option>
            <option value="liability" ${a.type==='liability'?'selected':''}>Liability</option>
            <option value="equity" ${a.type==='equity'?'selected':''}>Equity</option>
            <option value="revenue" ${a.type==='revenue'?'selected':''}>Revenue</option>
            <option value="expense" ${a.type==='expense'?'selected':''}>Expense</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Account name</label>
        <input type="text" id="fCoaName" value="${a.name.replace(/"/g,'&quot;')}"/>
      </div>
      <div class="form-group">
        <label>Subtype</label>
        <input type="text" id="fCoaSubtype" value="${a.subtype || ''}"/>
      </div>
      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="app.saveAccount()">Save changes</button>
      </div>`;
    overlay.classList.add('open');
  },

  async deleteAccount(id, name) {
    if (!confirm(`Delete account "${name}"?\n\nThis cannot be undone.`)) return;
    const { error } = await supabaseClient.from('accounts').delete().eq('id', id);
    if (error) { this.showToast('Delete failed: ' + error.message, 'error'); return; }
    this.showToast('Account deleted', 'success');
    await this._reloadCOA();
  },

  // ---- BANK ACTIONS ----
  syncBank(entity, last4) {
    const label = entity === 'ALL' ? 'processor' : `${entity} ••••${last4}`;
    this.toast(`Syncing ${label}…`);
    setTimeout(() => {
      const b = DATA.banks.find(x => x.entity === entity && x.last4 === last4);
      if (b) b.synced = 'Just now';
      this.renderBanks();
      this.toast(`${label} sync complete`);
    }, 1400);
  },

  viewBankTxns(entity) {
    const filter = document.getElementById('txnEntityFilter');
    if (filter) filter.value = entity === 'ALL' ? '' : entity;
    this.navigate('transactions');
  },

  // ---- ROLE-BASED LOGIN ----
  login() {
    const pass = document.getElementById('loginPass')?.value?.trim();
    const errEl = document.getElementById('loginError');
    for (const [role, cfg] of Object.entries(ROLES)) {
      if (pass === cfg.pass) {
        localStorage.setItem('wbRole', JSON.stringify({ role, label: cfg.label }));
        this._applyRole(role, cfg.label);
        document.getElementById('loginScreen').style.display = 'none';
        return;
      }
    }
    if (errEl) errEl.textContent = 'Incorrect access code. Try again.';
  },

  logout() {
    localStorage.removeItem('wbRole');
    document.getElementById('loginPass').value = '';
    document.getElementById('loginError').textContent = '';
    document.getElementById('loginScreen').style.display = '';
    // Hide AI panel
    const aiPanel = document.getElementById('aiPanel');
    const aiTab   = document.getElementById('aiPanelTab');
    if (aiPanel) aiPanel.classList.add('collapsed');
    if (aiTab)   aiTab.style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('roleLabel').textContent = '';
  },

  _applyRole(role, label) {
    // Show/hide nav items based on role
    document.querySelectorAll('[data-roles]').forEach(el => {
      const roles = el.getAttribute('data-roles').split(',').map(r => r.trim());
      el.style.display = roles.includes(role) ? '' : 'none';
    });
    // Show role label & logout btn
    const lbl = document.getElementById('roleLabel');
    if (lbl) lbl.textContent = label;
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.style.display = '';
    // Show AI panel tab for COO only
    const aiTab = document.getElementById('aiPanelTab');
    if (aiTab) aiTab.style.display = role === 'coo' ? '' : 'none';
    // Navigate to default page for role
    const defaultPage = { coo: 'dashboard', bookkeeper: 'inbox', cpa: 'pnl', admin: 'dashboard' }[role] || 'dashboard';
    this.navigate(defaultPage);
    this.renderGfbChips();
    this.updateTopbarKPIs();
  },

  // ---- AI ADVISOR PANEL ----
  toggleAiPanel() {
    const panel = document.getElementById('aiPanel');
    const tab   = document.getElementById('aiPanelTab');
    if (!panel) return;
    const collapsed = panel.classList.toggle('collapsed');
    if (tab) tab.style.display = collapsed ? '' : 'none';
    if (!collapsed && !this._aiWelcomed) {
      this._aiWelcomed = true;
      this._renderAiWelcome();
    }
  },

  connectAiKey() {
    const key = document.getElementById('aiKeyInput')?.value?.trim();
    if (!key) return;
    localStorage.setItem('wbAiKey', key);
    this._updateAiKeyStatus(true);
    this.toast('AI Advisor connected');
  },

  _updateAiKeyStatus(connected) {
    const dot = document.getElementById('aiKeyStatus');
    const bar = document.getElementById('aiKeyBar');
    if (dot) dot.className = 'ai-key-dot ' + (connected ? 'connected' : '');
    if (bar) bar.style.display = connected ? 'none' : '';
  },

  _renderAiWelcome() {
    const msgs = document.getElementById('aiMessages');
    if (!msgs) return;
    msgs.innerHTML = `<div class="ai-msg ai-msg-assistant"><div class="ai-bubble">Hi! I'm your AI financial advisor. Ask me anything about WB Brands' performance — margins, cash runway, AR aging, or what to focus on this month.</div></div>`;
  },

  async sendAiMessage() {
    const key = localStorage.getItem('wbAiKey');
    if (!key) { this.toast('Connect your Anthropic API key first'); return; }
    const input = document.getElementById('aiInput');
    const text = input?.value?.trim();
    if (!text) return;
    input.value = '';
    this._appendAiMsg('user', text);
    const thinking = this._appendAiThinking();
    try {
      const context = await this.buildFinancialContext();
      if (!window._AI_HISTORY) window._AI_HISTORY = [];
      window._AI_HISTORY.push({ role: 'user', content: text });
      const response = await this.callAnthropicAPI(key, context, window._AI_HISTORY);
      thinking.remove();
      window._AI_HISTORY.push({ role: 'assistant', content: response });
      this._appendAiMsg('assistant', response);
    } catch (err) {
      thinking.remove();
      this._appendAiMsg('assistant', `Error: ${err.message}`);
    }
  },

  async callAnthropicAPI(apiKey, context, history) {
    const systemPrompt = `You are Rizwan's personal CFO and financial thinking partner for WB Brands LLC (a promo-products group: Lanyards, Wristbands, Can Coolers, Swagprint across LP, KP, BP, WBP, ONEOPS entities).

PERSONALITY: Sharp, direct, no fluff. Use actual numbers from the context. Add ONE insight on blind spots/risks/opportunities. End with 2–3 follow-up questions (bulleted with →). Keep total response under 150 words.

LIVE FINANCIAL CONTEXT:
${context}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: history,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text || '';
  },

  async buildFinancialContext() {
    const entity = state.globalEntity;
    const fmt = n => '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const pct = n => (n * 100).toFixed(1) + '%';

    // Pull current period P&L data
    let rev = 0, cogs = 0, adSpend = 0, otherExp = 0, adjEntries = 0;
    if (supabaseClient) {
      let q = supabaseClient.from('transactions')
        .select('amount, accounts(account_type, account_subtype)')
        .gte('acc_date', state.globalPeriodRange.from).lte('acc_date', state.globalPeriodRange.to);
      q = applyEntityFilter(q, entity);
      const { data: txns } = await q;
      for (const t of (txns || [])) {
        const amt = Number(t.amount);
        if (t.accounts?.account_type === 'revenue') rev += amt;
        else if (t.accounts?.account_type === 'expense') {
          const sub = t.accounts?.account_subtype;
          if (sub === 'cogs') cogs += Math.abs(amt);
          else if (sub === 'advertising') adSpend += Math.abs(amt);
          else otherExp += Math.abs(amt);
        }
      }
      // Journal adjustments
      const { data: jEntries } = await supabaseClient.from('journal_entries')
        .select('ledger_entries(debit_amount,credit_amount,accounts(account_type))')
        .eq('entry_type', 'adjusting')
        .gte('period', state.globalPeriodRange.from.slice(0,7))
        .lte('period', state.globalPeriodRange.to.slice(0,7));
      for (const je of (jEntries || [])) {
        for (const le of (je.ledger_entries || [])) {
          if (le.accounts?.account_type === 'revenue') adjEntries += (Number(le.credit_amount) - Number(le.debit_amount));
        }
      }
    }
    const grossProfit = rev - cogs;
    const totalExp = adSpend + otherExp;
    const netProfit = grossProfit - totalExp + adjEntries;
    const gpMargin = rev > 0 ? grossProfit / rev : 0;
    const npMargin = rev > 0 ? netProfit / rev : 0;

    // AR aging
    const openInvoices = DATA.invoices.filter(i => i.status !== 'paid');
    const totalAR = openInvoices.reduce((s, i) => s + (Number(i.amount) - Number(i.amount_paid || 0)), 0);
    const overdueAR = openInvoices.filter(i => i.status === 'overdue').reduce((s, i) => s + (Number(i.amount) - Number(i.amount_paid || 0)), 0);

    // Top vendors
    const topVendors = [...DATA.vendors].sort((a, b) => Number(b.ytd) - Number(a.ytd)).slice(0, 3);

    const periodLabel = this.getPeriodLabel(state.globalPeriod);
    return [
      `Period: ${periodLabel} | Entity: ${entity === 'all' ? 'All Companies' : entity}`,
      `Revenue: ${fmt(rev)} | COGS: ${fmt(cogs)} | Gross Profit: ${fmt(grossProfit)} (${pct(gpMargin)})`,
      `Ad Spend: ${fmt(adSpend)} | Other OpEx: ${fmt(otherExp)} | Net Profit: ${fmt(netProfit)} (${pct(npMargin)})`,
      `AR Outstanding: ${fmt(totalAR)} | Overdue AR: ${fmt(overdueAR)}`,
      topVendors.length ? `Top vendors by YTD spend: ${topVendors.map(v => v.name + ' ' + fmt(Number(v.ytd))).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  },

  _appendAiMsg(role, text) {
    const msgs = document.getElementById('aiMessages');
    if (!msgs) return null;
    const div = document.createElement('div');
    div.className = `ai-msg ai-msg-${role}`;
    // Simple markdown: bold, bullets
    const formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^→ /gm, '• ');
    div.innerHTML = `<div class="ai-bubble">${formatted}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  },

  _appendAiThinking() {
    const msgs = document.getElementById('aiMessages');
    if (!msgs) return { remove: () => {} };
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-assistant';
    div.innerHTML = '<div class="ai-bubble ai-thinking">Analyzing your data…</div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  },

  fmtM(n) {
    if (Math.abs(n) >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${Math.round(n/1e3)}K`;
    return `$${Math.round(n)}`;
  },

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position:fixed; bottom:20px; right:20px; z-index:9999;
      background:${type==='success'?'#16a34a':type==='error'?'#dc2626':'#334155'};
      color:#fff; padding:10px 18px; border-radius:8px; font-size:0.82rem;
      box-shadow:0 4px 16px rgba(0,0,0,0.2); animation:fadeIn 0.2s;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  },

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
      netEl.style.color = '';
    }
    netEl.style.display = '';
  },

  toggleDarkMode() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('wb-theme', next);
    const sunIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    const moonIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
    const btn = document.getElementById('themeToggle');
    if (btn) btn.innerHTML = next === 'dark' ? moonIcon : sunIcon;
  },

  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  },

  agingBucket(dueDateStr) {
    if (!dueDateStr) return { label: '—', cls: '' };
    const days = Math.floor((Date.now() - new Date(dueDateStr)) / 86400000);
    if (days < 0)   return { label: 'Current',   cls: 'current',  days };
    if (days <= 30) return { label: '1-30 Days',  cls: 'low',      days };
    if (days <= 60) return { label: '31-60 Days', cls: 'medium',   days };
    if (days <= 90) return { label: '61-90 Days', cls: 'high',     days };
    return            { label: '90+ Days',    cls: 'critical', days };
  },

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

    const total   = items.reduce((s,i) => s + i.amount, 0);
    const overdue = items.filter(i => new Date(i.due_date) < new Date()).reduce((s,i) => s+i.amount, 0);
    const dueWeek = items.filter(i => { const d=new Date(i.due_date); return d>=new Date() && d<=new Date(now+weekMs); }).reduce((s,i)=>s+i.amount,0);
    const avgDays = items.length ? Math.round(items.reduce((s,i)=>s+(this.agingBucket(i.due_date).days||0),0)/items.length) : 0;

    const set = (id, val) => { const el=document.getElementById(id); if (el) el.textContent=val; };
    set('apTotal',   fmt(total));
    set('apOverdue', fmt(overdue));
    set('apDueWeek', fmt(dueWeek));
    set('apAvgDays', avgDays + ' days');

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
          <div class="aging-cell-val">${fmt(bktData[b].total)}</div>
          <div class="aging-cell-count">${bktData[b].count} invoice${bktData[b].count!==1?'s':''}</div>
        </div>`).join('');
    }

    const vendorSel = document.getElementById('apVendorFilter');
    if (vendorSel) {
      const vendors = [...new Set(items.map(i=>i.vendor))].sort();
      vendorSel.innerHTML = '<option value="">All Vendors</option>' + vendors.map(v=>`<option value="${v}">${v}</option>`).join('');
    }

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
        <td class="r">${fmt(item.amount)}</td>
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
};

// ---- REPORT HELPERS ----
function pnlSection(title) {
  return `<div class="report-section-title">${title}</div>`;
}
function _cmpCols(label, curAmt) {
  if (!_pnlCmp || curAmt === null || curAmt === undefined) return '';
  const key = _pnlNorm(label);
  const cmpAmt = _pnlCmp[key];
  if (cmpAmt === undefined) return '<span class="report-amount-cmp">—</span><span class="report-amount-var"></span>';
  const varAmt = curAmt - cmpAmt;
  const varColor = varAmt >= 0 ? 'var(--green)' : 'var(--red)';
  const varStr = varAmt === 0 ? '—' : (varAmt > 0 ? `+${fmt(varAmt)}` : `(${fmt(Math.abs(varAmt))})`);
  return `<span class="report-amount-cmp">${cmpAmt < 0 ? `(${fmt(Math.abs(cmpAmt))})` : fmt(cmpAmt)}</span><span class="report-amount-var" style="color:${varColor}">${varStr}</span>`;
}
function pnlLine(label, amount, indent, style = '', accountId = null) {
  const cls = indent === 2 ? 'indent2' : 'indent1';
  if (!amount && amount !== 0) return `<div class="report-line ${cls}"><span style="font-weight:${style==='group'?'500':'400'}">${label}</span>${_pnlCmp ? '<span></span><span></span><span></span>' : ''}</div>`;
  const muted = style === 'muted';
  const amtStr = amount < 0 ? `(${fmt(Math.abs(amount))})` : fmt(amount);
  const drillAttr = (accountId && amount !== null && amount !== undefined)
    ? `onclick="app.drillDown('${accountId}','${label.replace(/'/g,"\\'")}')" style="cursor:pointer;text-decoration:underline dotted var(--text3)"`
    : '';
  return `<div class="report-line ${cls}">
    <span style="color:${muted?'var(--text3)':'inherit'};font-size:${muted?'11px':'13px'}">${label}</span>
    ${!muted ? `<span class="report-amount ${style==='pos'?'pos':style==='neg'?'neg':''}" ${drillAttr}>${amtStr}</span>${_cmpCols(label, amount)}` : `${_pnlCmp ? '<span></span><span></span><span></span>' : ''}`}
  </div>`;
}
function pnlTotal(label, amount, style = '') {
  const amtStr = amount < 0 ? `(${fmt(Math.abs(amount))})` : fmt(amount);
  return `<div class="report-line total">
    <span>${label}</span>
    <span class="report-amount ${style}">${amtStr}</span>
    ${_cmpCols(label, amount)}
  </div>`;
}
function pnlGrand(label, amount, style = '') {
  const amtStr = amount < 0 ? `(${fmt(Math.abs(amount))})` : fmt(amount);
  return `<div class="report-line grand-total">
    <span>${label}</span>
    <span class="report-amount ${style}" style="font-size:15px">${amtStr}</span>
    ${_cmpCols(label, amount)}
  </div>`;
}

// ---- UTILS ----
function fmt(n) {
  if (n === null || n === undefined) return '';
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function today() {
  return new Date().toISOString().split('T')[0];
}

// ---- CHART INITIALIZATION ----
function initDashboardCharts() {
  // Professional palette matching reference dashboard
  const C = {
    navy:'#1B3A6B', teal:'#0D6B74', green:'#1A7A4A',
    amber:'#D4770A', red:'#C0392B', purple:'#6B2FAA',
    slate:'#1565C0', moss:'#558B2F'
  };
  const rgba = (hex, a) => {
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  };
  state._chartColors = { C, rgba };

  const days = Array.from({length:31},(_,i)=>i+1+'');
  const zeros31 = days.map(() => 0);

  state.charts = state.charts || {};

  state.charts.revenue = new Chart(document.getElementById('revenueChart'), {
    type:'bar',
    data:{ labels:days, datasets:[
      {label:'Revenue',  data:[...zeros31],  backgroundColor:rgba(C.navy,0.85), stack:'s', borderRadius:2},
      {label:'Expenses', data:[...zeros31], backgroundColor:rgba(C.teal,0.85), stack:'s', borderRadius:2},
      {label:'Net',      data:[...zeros31],      backgroundColor:rgba(C.green,0.85), stack:'s', borderRadius:2}
    ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{
      x:{stacked:true, ticks:{maxTicksLimit:10,font:{size:10}}, grid:{display:false}},
      y:{stacked:true, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'k',font:{size:10}}, grid:{color:'rgba(0,0,0,0.04)'}}
    }}
  });

  const expLabels = ['COGS','Payroll','Ad spend','Shipping','Platform','Other'];
  const expColors = [C.navy, C.teal, C.red, C.amber, C.green, C.slate];
  state.charts.expenseDonut = new Chart(document.getElementById('expenseDonut'), {
    type:'doughnut',
    data:{ labels:expLabels, datasets:[{data:[0,0,0,0,0,0], backgroundColor:expColors, borderWidth:2, borderColor:'#fff'}] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, cutout:'68%' }
  });

  document.getElementById('donutLegend').innerHTML = expLabels.map((l,i)=>
    `<span><em style="background:${expColors[i]}"></em>${l}</span>`).join('');

  state.charts.entity = new Chart(document.getElementById('entityChart'), {
    type:'bar',
    data:{ labels:['LP','KP','BP','WBP','ONEOPS'], datasets:[{data:[0,0,0,0,0], backgroundColor:[rgba(C.navy,0.85),rgba(C.teal,0.85),rgba(C.green,0.85),rgba(C.amber,0.85),rgba(C.purple,0.85)], borderRadius:4, borderWidth:0}] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{
      x:{ticks:{font:{size:11}}, grid:{display:false}},
      y:{ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'k',font:{size:10}}, grid:{color:'rgba(0,0,0,0.04)'}}
    }}
  });

  state.charts.trend = new Chart(document.getElementById('trendChart'), {
    type:'line',
    data:{ labels:['6mo ago','5mo ago','4mo ago','3mo ago','2mo ago','This month'], datasets:[
      {label:'Net profit', data:[0,0,0,0,0,0], borderColor:C.green, backgroundColor:rgba(C.green,0.07), fill:true, tension:0.4, pointRadius:4, pointBackgroundColor:C.green},
      {label:'Ad spend',   data:[0,0,0,0,0,0], borderColor:C.navy,  borderDash:[4,3], fill:false, tension:0.4, pointRadius:3}
    ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{
      x:{ticks:{font:{size:10}}, grid:{display:false}},
      y:{ticks:{callback:v=>'$'+(v>=0?'':'-')+(Math.abs(v)/1000).toFixed(0)+'k',font:{size:10}}, grid:{color:'rgba(0,0,0,0.04)'}}
    }}
  });

  document.getElementById('cashBars').innerHTML =
    '<p style="color:var(--text3);font-size:13px;padding:12px">No bank data yet</p>';
}

// ---- BOOT ----
document.addEventListener('DOMContentLoaded', async () => {
  // Restore saved theme preference
  const savedTheme = localStorage.getItem('wb-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  if (savedTheme === 'dark') {
    const moonIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
    const btn = document.getElementById('themeToggle');
    if (btn) btn.innerHTML = moonIcon;
  }

  // Populate period picker with last 13 months
  const picker = document.getElementById('periodPicker');
  if (picker) {
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const now = new Date();
    for (let i = 0; i < 13; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = d.toISOString().slice(0, 7);
      const label = monthNames[d.getMonth()] + ' ' + d.getFullYear();
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === state.globalPeriodRange.from.slice(0,7)) opt.selected = true;
      picker.appendChild(opt);
    }
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await loadDataFromSupabase();
  initDashboardCharts();

  // Check for saved AI key
  const savedAiKey = localStorage.getItem('wbAiKey');
  if (savedAiKey) app._updateAiKeyStatus(true);

  // Check for saved role — auto-login if present
  const savedRole = localStorage.getItem('wbRole');
  if (savedRole) {
    try {
      const { role, label } = JSON.parse(savedRole);
      document.getElementById('loginScreen').style.display = 'none';
      app._applyRole(role, label);
    } catch {
      localStorage.removeItem('wbRole');
    }
  }

  ['txnEntityFilter','txnTypeFilter','txnStatusFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => app.filterTransactions());
  });

  // Close autocomplete dropdown when clicking outside
  document.addEventListener('click', e => {
    const wrap = document.querySelector('.autocomplete-wrap');
    if (wrap && !wrap.contains(e.target)) {
      const dd = document.getElementById('txnSuggest');
      if (dd) dd.classList.remove('open');
    }
  });
});

// Sidebar toggle keyboard shortcut
document.addEventListener('keydown', function(e) {
  if (e.key === '[' && !e.target.matches('input,textarea,select,[contenteditable]')) {
    app.toggleSidebar();
  }
});
