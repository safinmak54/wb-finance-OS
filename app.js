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
      window._entityByCode[e.code] = e.id;
      window._entityById[e.id] = e.code;
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
    if (!txnErr && txns && txns.length > 0) {
      DATA.transactions = txns.map(t => ({
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
      // Update sidebar review badge
      const reviewCount = DATA.transactions.filter(t => t.status === 'review').length;
      const badge = document.getElementById('reviewBadge');
      if (badge) badge.textContent = reviewCount || '';
    }

    // Load vendors
    const { data: vendors, error: venErr } = await supabaseClient
      .from('vendors').select('*').order('name');
    if (!venErr && vendors && vendors.length > 0) {
      DATA.vendors = vendors.map(v => ({
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
      // Update overdue badge
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
  currentEntity: 'all',
  currentPeriod: new Date().toISOString().slice(0, 7),
  txnPage: 1,
  txnPageSize: 15,
  txnSort: { field: 'accDate', dir: 'desc' },
  filteredTxns: [...DATA.transactions],
  charts: {}
};

// ---- MAIN APP OBJECT ----
const app = {
  // Navigation
  navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    const navEl = document.querySelector(`[data-page="${page}"]`);
    if (navEl) navEl.classList.add('active');
    state.currentPage = page;

    const period = this.getPeriodLabel(state.currentPeriod);
    const titles = {
      dashboard: ['Dashboard', `${period} · Consolidated view`],
      transactions: ['Transactions', `All entities · ${period}`],
      journals: ['Journal Entries', 'Double-entry ledger'],
      reconcile: ['Reconciliation', `Bank vs book · ${period}`],
      vendors: ['Vendors', 'Payables management'],
      invoices: ['Invoices', 'Vendor invoices'],
      pnl: ['Profit & Loss', `Consolidated · ${period}`],
      balance: ['Balance Sheet', `As of ${period}`],
      cashflow: ['Cash Flow', period],
      coa: ['Chart of Accounts', 'WB Brands LLC · All entities'],
      banks: ['Bank Connections', 'Connected accounts & processors'],
    };
    const [title, sub] = titles[page] || ['—', ''];
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageSub').textContent = sub;

    // Close sidebar on mobile after navigation
    if (window.innerWidth <= 768) this.closeSidebar();

    // Render page-specific content
    setTimeout(async () => {
      if (page === 'dashboard')    await this.updateDashboardKPIs();
      if (page === 'transactions') this.renderTransactions();
      if (page === 'vendors')      this.renderVendors();
      if (page === 'invoices')     this.renderInvoices();
      if (page === 'pnl')          this.renderPnL();
      if (page === 'balance')      this.renderBalance();
      if (page === 'journals')     this.renderJournals();
      if (page === 'coa')          this.renderCOA();
      if (page === 'banks')        this.renderBanks();
      if (page === 'reconcile')    this.renderReconcile();
      if (page === 'cashflow')     this.renderCashflow();
    }, 10);
  },

  async setEntity(val) {
    state.currentEntity = val;
    const pg = state.currentPage;
    if (pg === 'transactions') this.renderTransactions();
    else if (pg === 'vendors')  this.renderVendors();
    else if (pg === 'invoices') this.renderInvoices();
    else if (pg === 'pnl')      this.renderPnL();
    else if (pg === 'balance')  this.renderBalance();
    else if (pg === 'dashboard') await this.updateDashboardKPIs();
  },

  setPeriod(val) {
    state.currentPeriod = val;
    this.navigate(state.currentPage);
  },

  getPeriodLabel(val) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const [year, month] = val.split('-');
    return `${months[parseInt(month, 10) - 1]} ${year}`;
  },

  getActiveTxns() {
    const p = state.currentPeriod;
    return DATA.transactions.filter(t => t.accDate && t.accDate.startsWith(p));
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

  // ---- P&L REPORT ----
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

  setPnlEntity(val) { this.renderPnL(val); },

  // ---- BALANCE SHEET ----
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

  // ---- JOURNALS ----
  renderJournals() {
    const tbody = document.getElementById('journalBody');
    tbody.innerHTML = DATA.journals.map(j => `
      <tr>
        <td style="font-family:var(--mono);font-size:11px">${j.id}</td>
        <td>${j.date}</td>
        <td>${j.memo}</td>
        <td style="font-size:11px">${j.account}</td>
        <td class="amount">${j.debit ? fmt(j.debit) : '—'}</td>
        <td class="amount">${j.credit ? fmt(j.credit) : '—'}</td>
        <td><span class="badge badge-transfer" style="font-size:10px">${j.entity}</span></td>
        <td><span class="badge ${j.type === 'elimination' ? 'badge-transfer' : j.type === 'distribution' ? 'badge-expense' : 'badge-review'}">${j.type}</span></td>
      </tr>`).join('');
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
    const list = DATA.invoices.filter(i => !filter || i.status === filter);
    const tbody = document.getElementById('invoiceBody');
    tbody.innerHTML = list.map(i => {
      const remaining = i.amount - i.paid;
      const daysOverdue = i.status === 'overdue' ? Math.round((new Date() - new Date(i.due)) / 86400000) : 0;
      return `<tr>
        <td style="font-family:var(--mono);font-size:11px">${i.invoiceNum}</td>
        <td style="font-weight:500">${i.vendor}</td>
        <td style="font-size:11px">${i.date}</td>
        <td style="font-size:11px;${i.status === 'overdue' ? 'color:var(--red)' : ''}">${i.due}${daysOverdue > 0 ? ` <span style="font-size:10px">(${daysOverdue}d late)</span>` : ''}</td>
        <td class="amount">${fmt(i.amount)}</td>
        <td class="amount-pos">${i.paid ? fmt(i.paid) : '—'}</td>
        <td class="amount ${remaining > 0 ? 'amount-neg' : ''}">${remaining > 0 ? fmt(remaining) : '—'}</td>
        <td><span class="badge badge-${i.status}">${i.status}</span></td>
        <td>
          <div style="display:flex;gap:4px">
            ${i.status !== 'paid' ? `<button class="action-btn primary btn-sm" onclick="app.payInvoice('${i.id}')">Pay</button>` : ''}
            <button class="action-btn btn-sm" onclick="app.viewInvoice('${i.id}')">View</button>
          </div>
        </td>
      </tr>`;
    }).join('');
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
        <td style="font-size:11px;color:var(--text2)">${a.subtype}</td>
        <td style="font-size:11px">${a.line}</td>
        <td class="amount ${a.balance < 0 ? 'amount-neg' : ''}">${fmt(Math.abs(a.balance))}</td>
        <td>${a.elimination ? '<span class="badge badge-transfer">Yes</span>' : '<span style="color:var(--text3);font-size:11px">—</span>'}</td>
      </tr>`).join('');
  },

  // ---- BANKS ----
  renderBanks() {
    const grid = document.getElementById('banksGrid');
    const colors = { LP:'#3B82F6', KP:'#10B981', BP:'#8B5CF6', WBP:'#F59E0B', ONEOPS:'#EF4444', ALL:'#6B7280' };
    grid.innerHTML = DATA.banks.map(b => `
      <div class="bank-card">
        <div class="bank-card-header">
          <span class="bank-entity" style="color:${colors[b.entity]}">${b.entity === 'ALL' ? 'PROCESSOR' : b.entity}</span>
          <div class="bank-status">
            <div class="bank-dot" style="background:${b.connected ? 'var(--green)' : 'var(--red)'}"></div>
            <span style="font-size:11px;color:var(--text3)">${b.connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
        <div class="bank-name">${b.bank}</div>
        <div class="bank-acct">${b.name} · ••••${b.last4} · ${b.type}</div>
        <div class="bank-balance" style="color:${b.balance < 0 ? 'var(--red)' : 'var(--text)'}">
          ${b.type === 'processor' ? 'Webhook live' : fmt(Math.abs(b.balance))}${b.balance < 0 ? ' CR' : ''}
        </div>
        <div class="bank-sync">Last sync: ${b.synced}</div>
        <div style="margin-top:10px;display:flex;gap:6px">
          <button class="btn-outline btn-sm" style="font-size:11px" onclick="app.syncBank('${b.entity}','${b.last4}')">↻ Sync now</button>
          <button class="btn-outline btn-sm" style="font-size:11px" onclick="app.viewBankTxns('${b.entity}')">View transactions</button>
        </div>
      </div>`).join('');
  },

  // ---- RECONCILE ----
  renderReconcile() {
    const txns = this.getActiveTxns();
    const matched = txns.filter(t => t.status === 'confirmed').length;
    const unmatched = txns.filter(t => t.status === 'review').length;
    const bankBal = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const bookBal = bankBal;
    const diff = bankBal - bookBal;
    const reconStats = document.getElementById('reconStats');
    if (reconStats) {
      reconStats.innerHTML = `
        <div class="recon-stat"><div class="rs-val">${fmt(bankBal)}</div><div class="rs-label">Bank balance</div></div>
        <div class="recon-stat"><div class="rs-val">${fmt(bookBal)}</div><div class="rs-label">Book balance</div></div>
        <div class="recon-stat success"><div class="rs-val">${fmt(diff)}</div><div class="rs-label">Difference</div></div>
        <div class="recon-stat"><div class="rs-val">${matched}</div><div class="rs-label">Matched txns</div></div>
        <div class="recon-stat warning"><div class="rs-val">${unmatched}</div><div class="rs-label">Unmatched</div></div>
      `;
    }
    const bankItems = [
      { date:'Mar 31', desc:'Stripe payout', amount:62400 },
      { date:'Mar 31', desc:'UPS ACH debit', amount:-18200 },
      { date:'Mar 30', desc:'ADP payroll', amount:-74500 },
      { date:'Mar 30', desc:'Intercompany transfer in', amount:140000 },
      { date:'Mar 29', desc:'PayPal sweep', amount:21800 },
    ];
    const bookItems = [
      { date:'Mar 31', desc:'Stripe payout — consolidated', amount:62400 },
      { date:'Mar 31', desc:'UPS bulk shipment', amount:-18200 },
      { date:'Mar 30', desc:'ADP payroll run', amount:-74500 },
      { date:'Mar 30', desc:'LP → One Ops transfer', amount:140000 },
      { date:'Mar 29', desc:'PayPal payout batch', amount:21800 },
    ];
    const matchRow = (item, matched) => `
      <tr>
        <td style="font-size:11px">${item.date}</td>
        <td style="font-size:12px">${item.desc}</td>
        <td class="${item.amount > 0 ? 'amount-pos' : 'amount-neg'}">${fmt(item.amount)}</td>
        <td>${matched ? '<span class="badge badge-confirmed">Matched</span>' : '<span class="badge badge-review">Unmatched</span>'}</td>
      </tr>`;
    document.getElementById('bankBody').innerHTML = bankItems.map(i => matchRow(i, true)).join('');
    document.getElementById('bookBody').innerHTML = bookItems.map(i => matchRow(i, true)).join('');
  },

  // ---- CASH FLOW ----
  renderCashflow() {
    if (!state.charts.cashflow) {
      const ctx = document.getElementById('cashflowChart');
      if (!ctx) return;
      state.charts.cashflow = new Chart(ctx, {
        type: 'line',
        data: {
          labels: Array.from({length:31},(_,i)=>`Mar ${i+1}`),
          datasets: [
            { label:'Operating',  data: Array.from({length:31},()=>Math.round(50000+Math.random()*80000)), borderColor:'#1B3A6B', fill:false, tension:0.4, pointRadius:2 },
            { label:'Cumulative', data: Array.from({length:31},(_,i)=>Math.round((i+1)*33000+Math.random()*20000)), borderColor:'#1A7A4A', fill:true, backgroundColor:'rgba(26,122,74,0.06)', tension:0.4, pointRadius:0 }
          ]
        },
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:11}}}}, scales:{x:{ticks:{maxTicksLimit:8,font:{size:10}},grid:{display:false}},y:{ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'k',font:{size:10}},grid:{color:'rgba(0,0,0,0.05)'}}} }
      });
    }

    if (!state.charts.waterfall) {
      const ctx2 = document.getElementById('waterfallChart');
      if (!ctx2) return;
      const labels = ['Revenue','Returns','COGS','Shipping','Payroll','Ad spend','Platform fees','Other opex','Net profit'];
      const data = [2957550,-42800,-985000,-128400,-371100,-393000,-73870,-20740,455040];
      const colors = data.map((v,i) => i===0||i===data.length-1 ? '#1A7A4A' : v<0 ? '#C0392B' : '#0D6B74');
      state.charts.waterfall = new Chart(ctx2, {
        type:'bar',
        data: { labels, datasets:[{ data: data.map(Math.abs), backgroundColor:colors, borderRadius:4, borderWidth:0 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(data[c.dataIndex])}}}, scales:{x:{ticks:{font:{size:10}},grid:{display:false}},y:{ticks:{callback:v=>'$'+(v/1000000).toFixed(1)+'M',font:{size:10}},grid:{color:'rgba(0,0,0,0.05)'}}} }
      });
    }
  },

  // ---- MODALS ----
  openModal(type, data = {}) {
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
      body.innerHTML = `
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
      const entityId = window._entityByCode[entityCode];
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
        if (state.currentPage === 'transactions') this.renderTransactions();
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
    const name = document.getElementById('fVendorName')?.value?.trim();
    const type = document.getElementById('fVendorType')?.value;
    if (!name) { this.toast('Vendor name is required'); return; }

    if (supabaseClient) {
      const { error } = await supabaseClient.from('vendors').insert({
        name, vendor_type: type, status: 'active', ytd_spend: 0, open_invoices: 0, overdue_count: 0
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
      const entityId = window._entityByCode[entityCode];

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
    a.download = `wb-transactions-${state.currentPeriod}.csv`;
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
        const headers = raw[0].map(String);
        const rows = raw.slice(1)
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

  autoDetectCSVColumns(headers) {
    const map = {};
    const n = s => s.toLowerCase().replace(/[^a-z]/g, '');
    headers.forEach((h, i) => {
      const k = n(h);
      if (['accdate','accountingdate','acctdate'].includes(k) || (k.includes('account') && k.includes('date'))) map.accDate = i;
      if (map.accDate === undefined && k.includes('date')) map.accDate = i;
      if (k === 'entity') map.entity = i;
      if (['description','desc','memo','narrative','details','reference'].includes(k)) map.desc = i;
      if (['vendor','payee','merchant','supplier'].includes(k)) map.vendor = i;
      if (['type','transactiontype','txntype','kind'].includes(k)) map.type = i;
      if (['category','categories','cat'].includes(k)) map.category = i;
      if (['amount','value','sum','total'].includes(k)) map.amount = i;
      if (['status','state'].includes(k)) map.status = i;
    });
    return map;
  },

  renderCSVMappingUI(headers, rows) {
    const fields = [
      { key: 'accDate',  label: 'Date',        required: true  },
      { key: 'entity',   label: 'Entity',       required: false },
      { key: 'desc',     label: 'Description',  required: true  },
      { key: 'vendor',   label: 'Vendor',       required: false },
      { key: 'type',     label: 'Type',         required: false },
      { key: 'category', label: 'Category',     required: false },
      { key: 'amount',   label: 'Amount',       required: true  },
      { key: 'status',   label: 'Status',       required: false },
    ];
    const autoMap = this.autoDetectCSVColumns(headers);
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

    document.getElementById('modalBody').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;color:var(--text)">${rows.length} rows detected</div>
        <button class="btn-outline btn-sm" onclick="app.openModal('importCSV')" style="font-size:11px">← Change file</button>
      </div>
      <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:10px">Column mapping</div>
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

  executeCSVImport() {
    const selects = document.querySelectorAll('.csv-map-select');
    const mapping = {};
    selects.forEach(s => { mapping[s.dataset.field] = parseInt(s.value); });

    if (mapping.accDate < 0)  { this.toast('Date column is required');        return; }
    if (mapping.desc < 0)     { this.toast('Description column is required'); return; }
    if (mapping.amount < 0)   { this.toast('Amount column is required');      return; }

    const { rows } = this._csvImportData;
    const validTypes = ['income','expense','transfer','payroll','cogs'];
    const now = Date.now();
    let imported = 0, skipped = 0;

    rows.forEach((row, idx) => {
      const accDate = row[mapping.accDate]?.replace(/"/g, '').trim();
      const desc    = row[mapping.desc]?.replace(/"/g, '').trim();
      const raw     = row[mapping.amount]?.replace(/["$,\s]/g, '');
      const amount  = parseFloat(raw);

      if (!accDate || !desc || isNaN(amount)) { skipped++; return; }

      const typeRaw = (mapping.type >= 0 ? row[mapping.type]?.trim().toLowerCase() : '') || '';
      const type = validTypes.includes(typeRaw) ? typeRaw : (amount >= 0 ? 'income' : 'expense');

      DATA.transactions.unshift({
        id:       `IMP-${now}-${idx}`,
        entity:   (mapping.entity   >= 0 ? row[mapping.entity]?.replace(/"/g,'').trim()   : '') || 'WB',
        desc,
        vendor:   (mapping.vendor   >= 0 ? row[mapping.vendor]?.replace(/"/g,'').trim()   : '') || '',
        type,
        category: (mapping.category >= 0 ? row[mapping.category]?.replace(/"/g,'').trim() : '') || 'Unclassified',
        amount,
        txnDate:  accDate,
        accDate,
        status:   (mapping.status   >= 0 ? row[mapping.status]?.trim().toLowerCase()      : '') || 'review',
        source:   'csv'
      });
      imported++;
    });

    // Refresh state
    state.filteredTxns = this.getActiveTxns();
    const reviewCount = DATA.transactions.filter(t => t.status === 'review').length;
    const badge = document.getElementById('reviewBadge');
    if (badge) badge.textContent = reviewCount || '';

    this.closeModal();
    this.toast(`${imported} transaction${imported !== 1 ? 's' : ''} imported${skipped ? `, ${skipped} skipped` : ''}`);
    if (state.currentPage !== 'transactions') this.navigate('transactions');
    else this.renderTransactions();
  },

  printReport() { window.print(); },

  // ---- SIDEBAR (mobile) ----
  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarBackdrop').classList.toggle('open');
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('open');
  },

  // ---- DASHBOARD KPIs ----
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

    // Cash: placeholder until bank sync
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

  // ---- INVOICE DETAIL ----
  viewInvoice(id) {
    const inv = DATA.invoices.find(i => i.id === id);
    if (inv) this.openModal('viewInvoice', inv);
  },

  // ---- ACCOUNT ----
  saveAccount() {
    const code    = document.getElementById('fCoaCode')?.value?.trim();
    const name    = document.getElementById('fCoaName')?.value?.trim();
    const type    = document.getElementById('fCoaType')?.value;
    const subtype = document.getElementById('fCoaSubtype')?.value?.trim();
    const line    = document.getElementById('fCoaLine')?.value?.trim();
    if (!code || !name) { this.toast('Code and name are required'); return; }
    if (DATA.coa.find(a => a.code === code)) { this.toast('Account code already exists'); return; }
    DATA.coa.push({ code, name, type, subtype: subtype || type, line: line || name, balance: 0, elimination: false });
    this.renderCOA();
    this.toast('Account added');
    this.closeModal();
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
  }
};

// ---- REPORT HELPERS ----
function pnlSection(title) {
  return `<div class="report-section-title">${title}</div>`;
}
function pnlLine(label, amount, indent, style = '') {
  const cls = indent === 2 ? 'indent2' : 'indent1';
  if (!amount && amount !== 0) return `<div class="report-line ${cls}"><span style="font-style:${style==='group'?'normal':''}; font-weight:${style==='group'?'500':'400'}">${label}</span></div>`;
  const muted = style === 'muted';
  return `<div class="report-line ${cls} ${muted?'':''}">
    <span style="color:${muted?'var(--text3)':'inherit'};font-size:${muted?'11px':'13px'}">${label}</span>
    ${!muted ? `<span class="report-amount ${style==='pos'?'pos':style==='neg'?'neg':style==='subtotal'?'':''}">
      ${amount < 0 ? `(${fmt(Math.abs(amount))})` : fmt(amount)}
    </span>` : ''}
  </div>`;
}
function pnlTotal(label, amount, style = '') {
  return `<div class="report-line total">
    <span>${label}</span>
    <span class="report-amount ${style}">${amount < 0 ? `(${fmt(Math.abs(amount))})` : fmt(amount)}</span>
  </div>`;
}
function pnlGrand(label, amount, style = '') {
  return `<div class="report-line grand-total">
    <span>${label}</span>
    <span class="report-amount ${style}" style="font-size:15px">${amount < 0 ? `(${fmt(Math.abs(amount))})` : fmt(amount)}</span>
  </div>`;
}

// ---- UTILS ----
function fmt(n) {
  if (n === null || n === undefined) return '';
  return '$' + Math.abs(Math.round(n)).toLocaleString();
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

  const days = Array.from({length:31},(_,i)=>i+1+'');
  const stripe = days.map(()=>Math.round(40000+Math.random()*35000));
  const paypal = days.map(()=>Math.round(12000+Math.random()*14000));
  const wire = days.map(()=>Math.round(8000+Math.random()*18000));

  new Chart(document.getElementById('revenueChart'), {
    type:'bar',
    data:{ labels:days, datasets:[
      {label:'Stripe', data:stripe, backgroundColor:rgba(C.navy,0.85), stack:'s', borderRadius:2},
      {label:'PayPal', data:paypal, backgroundColor:rgba(C.teal,0.85), stack:'s', borderRadius:2},
      {label:'Wire',   data:wire,   backgroundColor:rgba(C.green,0.85), stack:'s', borderRadius:2}
    ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{
      x:{stacked:true, ticks:{maxTicksLimit:10,font:{size:10}}, grid:{display:false}},
      y:{stacked:true, ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'k',font:{size:10}}, grid:{color:'rgba(0,0,0,0.04)'}}
    }}
  });

  const expLabels = ['COGS','Payroll','Ad spend','Shipping','Platform','Other'];
  const expData = [985, 371, 393, 128, 74, 21];
  const expColors = [C.navy, C.teal, C.red, C.amber, C.green, C.slate];
  new Chart(document.getElementById('expenseDonut'), {
    type:'doughnut',
    data:{ labels:expLabels, datasets:[{data:expData, backgroundColor:expColors, borderWidth:2, borderColor:'#fff'}] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, cutout:'68%' }
  });

  document.getElementById('donutLegend').innerHTML = expLabels.map((l,i)=>
    `<span><em style="background:${expColors[i]}"></em>${l}: $${expData[i]}k</span>`).join('');

  new Chart(document.getElementById('entityChart'), {
    type:'bar',
    data:{ labels:['LP','KP','BP','WBP'], datasets:[{data:[1100,780,520,558], backgroundColor:[rgba(C.navy,0.85),rgba(C.teal,0.85),rgba(C.green,0.85),rgba(C.amber,0.85)], borderRadius:4, borderWidth:0}] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{
      x:{ticks:{font:{size:11}}, grid:{display:false}},
      y:{ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'k',font:{size:10}}, grid:{color:'rgba(0,0,0,0.04)'}}
    }}
  });

  new Chart(document.getElementById('trendChart'), {
    type:'line',
    data:{ labels:['Oct','Nov','Dec','Jan','Feb','Mar'], datasets:[
      {label:'Net profit', data:[280,315,422,388,430,455], borderColor:C.green, backgroundColor:rgba(C.green,0.07), fill:true, tension:0.4, pointRadius:4, pointBackgroundColor:C.green},
      {label:'Ad spend',   data:[340,355,390,372,385,393], borderColor:C.navy,  borderDash:[4,3], fill:false, tension:0.4, pointRadius:3}
    ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{
      x:{ticks:{font:{size:10}}, grid:{display:false}},
      y:{ticks:{callback:v=>'$'+v+'k',font:{size:10}}, grid:{color:'rgba(0,0,0,0.04)'}}
    }}
  });

  const cashData = [
    {entity:'LP',      balance:284100, max:330000, color:C.navy},
    {entity:'KP',      balance:196400, max:330000, color:C.teal},
    {entity:'BP',      balance:88200,  max:330000, color:C.green},
    {entity:'WBP',     balance:142600, max:330000, color:C.amber},
    {entity:'One Ops', balance:318900, max:330000, color:C.red},
  ];
  document.getElementById('cashBars').innerHTML = cashData.map(c=>`
    <div class="cash-row">
      <span class="cash-entity">${c.entity}</span>
      <div class="cash-track"><div class="cash-fill" style="width:${Math.round((c.balance/c.max)*100)}%;background:${c.color}"></div></div>
      <span class="cash-amount">${fmt(c.balance)}</span>
    </div>`).join('');
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

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await loadDataFromSupabase();
  initDashboardCharts();
  await app.updateDashboardKPIs();
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
