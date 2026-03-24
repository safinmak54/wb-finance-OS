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

// ---- ENTITY GROUPS ----
const ENTITY_GROUPS = {
  wb_full:   ['WBP','LP','KP','BP','SWAG','RUSH'],
  one_ops:   ['ONEOPS'],
  sp_brands: ['SP1'],
};

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

    // Update dynamic chart titles
    const rcTitle = document.getElementById('revenueChartTitle');
    if (rcTitle) rcTitle.textContent = `Daily Revenue — ${period}`;
    const cfTitle = document.getElementById('cashflowTitle');
    if (cfTitle) cfTitle.textContent = `Cash Flow Statement — ${period}`;

    const titles = {
      dashboard: ['Dashboard', `${period} · Consolidated view`],
      inbox:  ['New Transactions', 'Unclassified transactions'],
      ledger: ['Ledger', `Classified transactions · ${period}`],
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
      if (page === 'inbox')        await this.renderInbox();
      if (page === 'ledger')       await this.renderLedger();
      if (page === 'vendors')      this.renderVendors();
      if (page === 'invoices')     this.renderInvoices();
      if (page === 'pnl')          await this.renderPnL();
      if (page === 'balance')      await this.renderBalance();
      if (page === 'journals')     await this.renderJournals();
      if (page === 'coa')          this.renderCOA();
      if (page === 'banks')        this.renderBanks();
      if (page === 'reconcile')    this.renderReconcile();
      if (page === 'cashflow')     await this.renderCashflow();
    }, 10);
  },

  async setEntity(val) {
    state.currentEntity = val;
    const pg = state.currentPage;
    if (pg === 'inbox')        await this.renderInbox();
    else if (pg === 'ledger') await this.renderLedger();
    else if (pg === 'vendors')  this.renderVendors();
    else if (pg === 'invoices') this.renderInvoices();
    else if (pg === 'pnl')      await this.renderPnL();
    else if (pg === 'balance')  await this.renderBalance();
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

  normalizeDate(str) {
    if (!str) return str;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    // YYYYMMDD (bank feed format: 20251231)
    const m3 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m3) return `${m3[1]}-${m3[2]}-${m3[3]}`;
    // MM/DD/YYYY
    const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    // DD-MM-YYYY
    const m2 = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (m2) return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
    return str;
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

  // ---- REPORT DATA HELPERS ----
  async fetchReportData(entity, period) {
    let txnQuery = supabaseClient
      .from('transactions')
      .select('amount, account_id, accounts(id, account_code, account_name, account_type, account_subtype, line, is_elimination)')
      .gte('acc_date', period + '-01')
      .lte('acc_date', period + '-31');
    txnQuery = applyEntityFilter(txnQuery, entity);
    const { data: txns, error: txnErr } = await txnQuery;
    if (txnErr) { console.error('Report txn error:', txnErr); return null; }

    const { data: journals } = await supabaseClient
      .from('journal_entries')
      .select('id, accounting_date, description, entry_type, period, entity_id, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name, account_type, account_subtype))')
      .eq('period', period);

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
  async renderPnL(entity) {
    if (entity === undefined) entity = state.currentEntity;
    const period = state.currentPeriod;
    const el = document.getElementById('pnlReport');
    el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

    const [data, closedRow] = await Promise.all([
      this.fetchReportData(entity, period),
      supabaseClient.from('closed_periods').select('closed_at').eq('period', period).maybeSingle()
    ]);
    if (!data) { el.innerHTML = '<div style="padding:32px;color:var(--red)">Failed to load report</div>'; return; }
    const isClosed = !!(closedRow?.data);

    const groups = this.groupByAccount(data.txns);
    const bySubtype = (sub) => Object.values(groups).filter(g => g.account.account_subtype === sub && !g.account.is_elimination);
    const byType = (type, excludeSubs = []) => Object.values(groups).filter(g => g.account.account_type === type && !g.account.is_elimination && !excludeSubs.includes(g.account.account_subtype));
    const sumLines = (lines) => lines.reduce((s, g) => s + g.total, 0);
    const renderLines = (lines, isExpense = false) => lines.map(g =>
      pnlLine(`${g.account.account_code} — ${g.account.account_name}`, isExpense ? Math.abs(g.total) : g.total, 2)
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
  },

  async setPnlEntity(val) { await this.renderPnL(val); },

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
    const byType = (type) => Object.values(groups).filter(g => g.account.account_type === type && !g.account.is_elimination);
    const sumLines = (lines) => lines.reduce((s, g) => s + g.total, 0);
    const renderLines = (lines, isLiab = false) => lines.map(g =>
      pnlLine(`${g.account.account_code} — ${g.account.account_name}`, isLiab ? Math.abs(g.total) : g.total, 2)
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
      ${!balanced && (totalAssets > 0 || totalLiab > 0) ? `<div style="color:var(--red);padding:8px;font-size:13px">⚠ Out of balance by ${fmt(Math.abs(totalAssets - totalLiabEquity))}</div>` : ''}
      ${totalAssets === 0 && totalLiab === 0 ? `<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">No transactions classified yet.</div>` : ''}
    `;
  },

  // ---- JOURNALS ----
  async renderJournals() {
    const el = document.getElementById('page-journals');
    if (!el) return;
    const period = state.currentPeriod;
    const periodLabel = this.getPeriodLabel(period);

    const { data: closedCheck } = await supabaseClient
      .from('closed_periods').select('id, closed_at').eq('period', period).maybeSingle();
    const isClosed = !!closedCheck;

    const { data: journals, error } = await supabaseClient
      .from('journal_entries')
      .select('id, accounting_date, description, entry_type, period, entity_id, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name))')
      .eq('period', period)
      .order('accounting_date', { ascending: false });
    if (error) console.error('Journal load error:', error);

    const displayRows = [];
    (journals || []).forEach(je => {
      const shortId = 'JE-' + je.id.slice(0,8).toUpperCase();
      (je.ledger_entries || []).forEach(line => {
        displayRows.push({
          id: shortId,
          date: je.accounting_date,
          memo: line.memo || je.description,
          account: line.accounts ? line.accounts.account_code + ' — ' + line.accounts.account_name : '',
          debit:  Number(line.debit_amount)  || 0,
          credit: Number(line.credit_amount) || 0,
          type: je.entry_type || 'manual'
        });
      });
    });

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left">
          <span style="font-size:13px;color:var(--text3)">${displayRows.length} entries</span>
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
            <thead><tr><th>ID</th><th>Date</th><th>Memo</th><th>Account</th><th>Debit</th><th>Credit</th><th>Type</th></tr></thead>
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
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
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
    if (!grid) return;
    grid.innerHTML = `
      <div style="grid-column:1/-1;padding:64px;text-align:center;color:var(--text3)">
        <div style="font-size:32px;margin-bottom:16px">🏦</div>
        <p style="font-size:15px;font-weight:600;margin-bottom:8px;color:var(--text2)">Bank Connections — Coming Soon</p>
        <p style="font-size:13px">Direct bank feeds and real-time balance sync will be available in a future update.<br>Use CSV import in the Inbox to load transactions in the meantime.</p>
      </div>
    `;
  },

  // ---- RECONCILE ----
  renderReconcile() {
    const reconStats = document.getElementById('reconStats');
    if (reconStats) reconStats.innerHTML = '';
    const bankBody = document.getElementById('bankBody');
    const bookBody = document.getElementById('bookBody');
    const placeholder = `<tr><td colspan="4" style="padding:48px;text-align:center;color:var(--text3);font-size:13px">Reconciliation requires bank connections — coming in a future update.</td></tr>`;
    if (bankBody) bankBody.innerHTML = placeholder;
    if (bookBody) bookBody.innerHTML = '';
  },

  // ---- CASH FLOW ----
  async renderCashflow() {
    const entity = state.currentEntity;
    const period = state.currentPeriod;

    // Destroy existing charts if re-rendering
    if (state.charts?.cashflow) { state.charts.cashflow.destroy(); delete state.charts.cashflow; }
    if (state.charts?.waterfall) { state.charts.waterfall.destroy(); delete state.charts.waterfall; }

    const cfCanvas = document.getElementById('cashflowChart');
    const wfCanvas = document.getElementById('waterfallChart');

    if (!supabaseClient) return;

    let q = supabaseClient
      .from('transactions')
      .select('amount, acc_date, accounts(account_type)')
      .gte('acc_date', period + '-01')
      .lte('acc_date', period + '-31')
      .order('acc_date', { ascending: true });
    q = applyEntityFilter(q, entity);

    const { data: txns, error } = await q;
    if (error) { console.error('Cashflow load error:', error); return; }

    const rows = txns || [];
    const daysInMonth = new Date(parseInt(period.split('-')[0]), parseInt(period.split('-')[1]), 0).getDate();
    const labels    = Array.from({length: daysInMonth}, (_, i) => String(i + 1));
    const inflows   = Array(daysInMonth).fill(0);
    const outflows  = Array(daysInMonth).fill(0);

    for (const t of rows) {
      const day = parseInt((t.acc_date || '').split('-')[2] || '0') - 1;
      if (day < 0 || day >= daysInMonth) continue;
      const amt = Number(t.amount);
      if (amt > 0) inflows[day]  += amt;
      else         outflows[day] += Math.abs(amt);
    }

    const totalIn  = inflows.reduce((s, v) => s + v, 0);
    const totalOut = outflows.reduce((s, v) => s + v, 0);
    const netFlow  = totalIn - totalOut;

    // Update card title with summary
    const titleEl = document.getElementById('cashflowTitle');
    if (titleEl) titleEl.textContent = rows.length === 0
      ? 'Cash Flow Statement'
      : `Cash Flow — In: ${fmt(totalIn)}  Out: (${fmt(totalOut)})  Net: ${netFlow >= 0 ? fmt(netFlow) : '(' + fmt(Math.abs(netFlow)) + ')'}`;

    if (rows.length === 0) {
      if (cfCanvas) cfCanvas.parentElement.innerHTML = '<canvas id="cashflowChart"></canvas><p style="padding:32px;text-align:center;color:var(--text3);font-size:13px">No classified transactions yet — inflow/outflow will appear here once transactions are classified.</p>';
      if (wfCanvas) wfCanvas.parentElement.innerHTML = '';
      return;
    }

    // Inflow / outflow bar chart
    if (cfCanvas) {
      state.charts = state.charts || {};
      state.charts.cashflow = new Chart(cfCanvas, {
        type:'bar',
        data:{ labels, datasets:[
          { label:'Inflows',  data:inflows,  backgroundColor:'rgba(22,163,74,0.75)',  borderRadius:2 },
          { label:'Outflows', data:outflows, backgroundColor:'rgba(220,38,38,0.75)', borderRadius:2 }
        ]},
        options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'top',labels:{font:{size:11}}}}, scales:{
          x:{ ticks:{maxTicksLimit:16,font:{size:10}}, grid:{display:false} },
          y:{ ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'k',font:{size:10}}, grid:{color:'rgba(0,0,0,0.04)'} }
        }}
      });
    }

    // Waterfall: running net cumulative
    if (wfCanvas) {
      const cumulative = [];
      let running = 0;
      for (let i = 0; i < daysInMonth; i++) {
        running += inflows[i] - outflows[i];
        cumulative.push(Math.round(running));
      }
      state.charts.waterfall = new Chart(wfCanvas, {
        type:'line',
        data:{ labels, datasets:[{
          label:'Cumulative Net', data:cumulative,
          borderColor:'#1B3A6B', backgroundColor:'rgba(27,58,107,0.07)',
          fill:true, tension:0.4, pointRadius:2, pointBackgroundColor:'#1B3A6B'
        }]},
        options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{
          x:{ ticks:{maxTicksLimit:16,font:{size:10}}, grid:{display:false} },
          y:{ ticks:{callback:v=>'$'+(v/1000).toFixed(0)+'k',font:{size:10}}, grid:{color:'rgba(0,0,0,0.04)'} }
        }}
      });
    }
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
      const uploadEntityOptions = ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS','SP1'].map(e =>
        `<option value="${e}" ${(this._csvImportEntity||'') === e ? 'selected' : ''}>${e}</option>`
      ).join('');
      body.innerHTML = `
        <div style="margin-bottom:16px">
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:6px">Entity <span style="color:var(--red)">*</span></div>
          <select id="uploadEntityPre" class="filter-select" style="width:100%" onchange="app._csvImportEntity=this.value">
            <option value="">— select entity —</option>
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

  // ---- INBOX ----
  async renderInbox() {
    const el = document.getElementById('inboxContent');
    if (!el) return;
    el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

    const { data: accounts } = await supabaseClient
      .from('accounts').select('id, account_code, account_name, account_type')
      .order('account_code');

    const { data: rawTxns, error } = await supabaseClient
      .from('raw_transactions').select('*').eq('classified', false)
      .order('transaction_date', { ascending: false });

    if (error) { this.toast('Failed to load transactions'); console.error(error); return; }

    const txns = rawTxns || [];
    const acctOptions = (accounts || []).map(a =>
      `<option value="${a.id}">${a.account_code} — ${a.account_name}</option>`
    ).join('');

    const allEntityCodes = ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS','SP1'];

    // Update sidebar badge
    const badge = document.getElementById('reviewBadge');
    if (badge) badge.textContent = txns.length || '';

    el.innerHTML = `
      <div class="toolbar">
        <div class="toolbar-left">
          <button class="btn-primary" onclick="app.openModal('importCSV')">↑ Upload CSV</button>
          <button class="btn-outline" onclick="app.openModal('newRawTxn')">+ Manual Entry</button>
          <button class="btn-outline" onclick="app.openRulesModal()" style="font-size:12px">⚡ Rules</button>
        </div>
        <div class="toolbar-right">
          <span style="font-size:13px;color:var(--text3)">${txns.length} to classify</span>
          <button class="btn-primary" id="bulkClassifyBtn" style="display:none;background:var(--green,#16a34a);border-color:var(--green,#16a34a)" onclick="app.bulkClassify()">Finalize Selected</button>
          <button class="btn-outline" id="bulkDeleteBtn" style="display:none;color:var(--red);border-color:var(--red)" onclick="app.bulkDelete()">Delete Selected</button>
        </div>
      </div>
      ${txns.length === 0 ? `
        <div style="padding:64px;text-align:center;color:var(--text3)">
          <p style="font-size:15px;margin-bottom:8px">No new transactions</p>
          <p style="font-size:13px">Upload a CSV or add a manual transaction to get started.</p>
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
                  <td style="font-size:12px;color:var(--text3);white-space:nowrap;cursor:default" title="Read-only — from CSV">${t.bank_account || '—'}</td>
                  <td style="font-size:12px;color:var(--text3);white-space:nowrap;font-family:var(--mono);cursor:default" title="Read-only — from CSV">${t.account_number || '—'}</td>
                  <td><input type="text" class="desc-edit" data-id="${t.id}" value="${(t.description || '').replace(/"/g,'&quot;')}" style="font-size:13px;border:1px solid transparent;background:transparent;width:100%;min-width:180px;padding:2px 4px;border-radius:4px" onblur="app.saveDescEdit(this)" onfocus="this.style.borderColor='var(--border)'" onblur="this.style.borderColor='transparent';app.saveDescEdit(this)"></td>
                  <td>
                    <select class="entity-sel filter-select" data-id="${t.id}" style="font-size:12px;padding:2px 6px">
                      ${allEntityCodes.map(e =>
                        `<option value="${e}" ${(window._entityById[t.entity_id]||'') === e ? 'selected' : ''}>${e}</option>`
                      ).join('')}
                    </select>
                  </td>
                  <td style="font-variant-numeric:tabular-nums;color:${t.direction === 'DEBIT' ? 'var(--red)' : 'var(--blue)'};font-weight:600">
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
      `}
    `;
    // Apply auto-classification rules after render
    this.applyClassificationRules();
  },

  toggleSelectAll(checkbox) {
    document.querySelectorAll('.row-check').forEach(c => c.checked = checkbox.checked);
    this.onRowCheck();
  },

  onRowCheck() {
    const checked = [...document.querySelectorAll('.row-check')].filter(c => c.checked);
    const n = checked.length;
    const classifyBtn = document.getElementById('bulkClassifyBtn');
    const deleteBtn   = document.getElementById('bulkDeleteBtn');
    if (classifyBtn) {
      classifyBtn.style.display = n > 0 ? 'inline-block' : 'none';
      classifyBtn.textContent = n > 0 ? `Finalize ${n} Transaction${n > 1 ? 's' : ''}` : 'Finalize Selected';
    }
    if (deleteBtn) deleteBtn.style.display = n > 0 ? 'inline-block' : 'none';
  },

  // ---- AUTO-CLASSIFICATION RULES ----
  applyClassificationRules() {
    const rules = DATA.classificationRules || [];
    if (!rules.length) return;
    document.querySelectorAll('#inboxTable tbody tr[data-id]').forEach(row => {
      const descInput = row.querySelector('.desc-edit');
      const acctSel   = row.querySelector('.acct-sel');
      if (!descInput || !acctSel || acctSel.value) return; // skip if already assigned
      const desc = descInput.value.toLowerCase();
      for (const rule of rules) {
        if (desc.includes(rule.pattern.toLowerCase())) {
          acctSel.value = rule.account_id;
          // Trigger green classify button
          const btn = row.querySelector('.classify-btn');
          if (btn) { btn.style.opacity = '1'; btn.style.background = 'var(--green,#16a34a)'; }
          // Subtle highlight to show auto-matched
          row.style.background = 'rgba(37,99,235,0.04)';
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

    // Build account options for add-rule form
    const acctOptHtml = (DATA.coa || []).map(a =>
      `<option value="${a.id}">${a.code} — ${a.name}</option>`
    ).join('');

    const defaultPatterns = [
      'Google Ads','Bing Ads','Meta Ads','Stripe','PayPal','US CBP','UPS','FedEx'
    ];

    modal.innerHTML = `
      <div style="font-size:15px;font-weight:600;margin-bottom:16px">⚡ Classification Rules</div>
      <p style="font-size:12px;color:var(--text3);margin-bottom:16px">Rules auto-assign a category when a transaction description contains the pattern (case-insensitive). First match wins.</p>

      <div style="margin-bottom:16px">
        <table class="data-table" style="font-size:12px">
          <thead><tr><th>Name</th><th>Pattern</th><th>Account</th><th></th></tr></thead>
          <tbody id="rulesTableBody">
            ${rules.length === 0
              ? `<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:16px">No rules yet</td></tr>`
              : rules.map(r => `
                <tr>
                  <td>${r.name}</td>
                  <td><code style="font-size:11px;background:var(--surface2);padding:1px 4px;border-radius:3px">${r.pattern}</code></td>
                  <td style="font-size:11px;color:var(--text2)">${(DATA.coa || []).find(a => a.id === r.account_id)?.name || r.account_id?.slice(0,8)+'…'}</td>
                  <td><button class="btn-outline" style="font-size:11px;padding:2px 8px;color:var(--red);border-color:var(--red)" onclick="app.deleteRule('${r.id}')">Delete</button></td>
                </tr>`).join('')
            }
          </tbody>
        </table>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:10px">Add Rule</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end">
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:3px">Name</div>
            <input id="ruleNameInput" type="text" placeholder="e.g. Google Ads" style="width:100%;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)">
          </div>
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:3px">Pattern (keyword)</div>
            <input id="rulePatternInput" type="text" placeholder="e.g. GOOGLE" style="width:100%;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface)">
          </div>
          <div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:3px">Account</div>
            <select id="ruleAccountSelect" class="filter-select" style="width:100%;font-size:12px">
              <option value="">— select —</option>
              ${acctOptHtml}
            </select>
          </div>
          <button class="btn-primary" style="font-size:12px;padding:5px 14px" onclick="app.saveRule()">Save</button>
        </div>
      </div>

      <div style="margin-bottom:14px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Quick-add defaults (select account for each):</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${defaultPatterns.map(p => `<button class="btn-outline" style="font-size:11px;padding:3px 10px" onclick="document.getElementById('ruleNameInput').value='${p}';document.getElementById('rulePatternInput').value='${p}'">${p}</button>`).join('')}
        </div>
      </div>

      <div class="form-actions">
        <button class="btn-outline" onclick="app.closeModal()">Close</button>
      </div>
    `;
    document.getElementById('modalTitle').textContent = 'Classification Rules';
    overlay.classList.add('open');
  },

  async saveRule() {
    const name      = document.getElementById('ruleNameInput')?.value?.trim();
    const pattern   = document.getElementById('rulePatternInput')?.value?.trim();
    const accountId = document.getElementById('ruleAccountSelect')?.value;
    if (!name || !pattern || !accountId) { this.toast('Fill in name, pattern, and account'); return; }

    const { error } = await supabaseClient.from('classification_rules').insert({
      name, pattern, account_id: accountId, is_active: true
    });
    if (error) { this.toast('Failed to save rule'); console.error(error); return; }

    // Reload rules and refresh modal
    const { data: rules } = await supabaseClient.from('classification_rules').select('*').eq('is_active', true).order('created_at');
    DATA.classificationRules = rules || [];
    this.toast(`Rule "${name}" saved`);
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
    const entityCode = row.querySelector('.entity-sel')?.value;
    if (!accountId)  { this.toast('Select a category first'); return; }
    if (!entityCode) { this.toast('Select an entity'); return; }

    const { data: t, error: loadErr } = await supabaseClient
      .from('raw_transactions').select('*').eq('id', rawId).single();
    if (loadErr) { this.toast('Could not load transaction'); return; }

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
    const checkedRows = [...document.querySelectorAll('.row-check:checked')].map(c => c.closest('tr'));
    if (!checkedRows.length) { this.toast('No rows selected'); return; }

    const rowsMissingCategory = checkedRows.filter(r => !r.querySelector('.acct-sel')?.value);
    if (rowsMissingCategory.length > 0) { this.toast(`${rowsMissingCategory.length} row(s) missing a category — select one for each`); return; }

    let success = 0, failed = 0;

    for (const row of checkedRows) {
      const rawId     = row.dataset.id;
      const accountId = row.querySelector('.acct-sel')?.value;
      const entityCode = row.querySelector('.entity-sel')?.value;
      if (!entityCode || !accountId) { failed++; continue; }

      const { data: t, error } = await supabaseClient.from('raw_transactions').select('*').eq('id', rawId).single();
      if (error) { failed++; continue; }

      const amount = t.direction === 'DEBIT' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount));
      const { error: insErr } = await supabaseClient.from('transactions').insert({
        raw_transaction_id: rawId, entity: entityCode, account_id: accountId, amount,
        txn_date: this.normalizeDate(t.transaction_date), acc_date: this.normalizeDate(t.accounting_date || t.transaction_date),
        description: t.description || '', memo: ''
      });

      if (insErr && insErr.code !== '23505') { failed++; continue; }

      await supabaseClient.from('raw_transactions').update({
        classified: true, classified_at: new Date().toISOString()
      }).eq('id', rawId);

      row.remove();
      success++;
    }

    this.toast(`${success} classified${failed ? `, ${failed} failed` : ''}`);
    document.getElementById('bulkClassifyBtn').style.display = 'none';
    document.getElementById('bulkDeleteBtn').style.display = 'none';
    const badge = document.getElementById('reviewBadge');
    if (badge) badge.textContent = Math.max(0, (parseInt(badge.textContent) || 0) - success) || '';
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
    const checkedRows = [...document.querySelectorAll('.row-check:checked')].map(c => c.closest('tr'));
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
    document.getElementById('bulkDeleteBtn').style.display = 'none';
    document.getElementById('bulkClassifyBtn').style.display = 'none';
    document.getElementById('inboxSelectAll').checked = false;
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
    this.toast(`Account ${code} created`);
    this.closeModal();
    await this.renderInbox();
  },

  // ---- LEDGER ----
  async renderLedger() {
    const el = document.getElementById('ledgerContent');
    if (!el) return;
    el.innerHTML = '<div style="padding:32px;color:var(--text3)">Loading…</div>';

    const entity = state.currentEntity;
    const period = state.currentPeriod;

    let query = supabaseClient
      .from('transactions')
      .select('*, accounts(account_code, account_name, account_type)')
      .order('acc_date', { ascending: false });

    query = applyEntityFilter(query, entity);
    if (period) query = query.gte('acc_date', period + '-01').lte('acc_date', period + '-31');

    const { data: txns, error } = await query;
    if (error) { this.toast('Failed to load ledger'); console.error(error); return; }

    let rows = txns || [];

    // Fallback: if period filter returned nothing, try without period to detect date format issues
    let showingAllPeriods = false;
    if (rows.length === 0 && period) {
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
    const entityLabel = entity === 'all' ? 'All Entities' : entity;
    const periodLabel = this.getPeriodLabel(period);
    const toolbar = `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg2)">
        <span style="font-size:12px;font-weight:600;background:var(--accent);color:#fff;padding:3px 10px;border-radius:20px">${entityLabel}</span>
        <span style="font-size:13px;color:var(--text2)">${showingAllPeriods ? 'All periods' : periodLabel}</span>
        ${showingAllPeriods ? `<span style="font-size:11px;color:var(--amber,#d97706);background:rgba(217,119,6,0.1);padding:2px 8px;border-radius:4px">⚠ No transactions in selected period — showing all</span>` : ''}
        <span style="font-size:12px;color:var(--text3);margin-left:auto">${rows.length} transaction${rows.length !== 1 ? 's' : ''}</span>
      </div>
    `;
    el.innerHTML = rows.length === 0 ? toolbar + `
      <div style="padding:64px;text-align:center;color:var(--text3)">
        <p style="font-size:15px;margin-bottom:8px">No classified transactions</p>
        <p style="font-size:13px">Classify transactions in the Inbox to see them here.</p>
      </div>
    ` : toolbar + `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Acc. Date</th><th>Description</th><th>Entity</th>
              <th>Category</th><th>Amount</th><th>Memo</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(t => {
              const amt = Number(t.amount);
              const amtColor = amt >= 0 ? 'var(--blue,#2563eb)' : 'var(--red,#dc2626)';
              const amtDisplay = amt < 0 ? `(${fmt(Math.abs(amt))})` : fmt(amt);
              return `
              <tr>
                <td>${t.acc_date || ''}</td>
                <td>${t.description || ''}</td>
                <td><span style="font-size:11px;font-weight:600;background:var(--accent);color:#fff;padding:2px 8px;border-radius:20px">${t.entity || ''}</span></td>
                <td>${t.accounts ? t.accounts.account_code + ' — ' + t.accounts.account_name : ''}</td>
                <td style="color:${amtColor};font-weight:600;font-variant-numeric:tabular-nums">${amtDisplay}</td>
                <td style="color:var(--text3);font-size:12px">${t.memo || ''}</td>
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

  autoDetectCSVColumns(headers, rows) {
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
      if (['debit','dr','debits','debitamount'].includes(k)) map.debit = i;
      if (['credit','cr','credits','creditamount'].includes(k)) map.credit = i;
      if (['status','state'].includes(k)) map.status = i;
      if (['bankaccount','accountname','acctname'].includes(k) ||
          (k.includes('account') && k.includes('name'))) map.bankAccount = i;
      if (['accountnumber','accountno','acctno','accountnum','acctnum'].includes(k) ||
          (k.includes('account') && (k.includes('number') || k.includes('num') || k.includes('no')))) map.accountNumber = i;
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
      { key: 'debit',       label: 'Debit',         required: false },
      { key: 'credit',      label: 'Credit',        required: false },
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

    const preEntity = this._csvImportEntity || '';
    const entityOptions = ['WBP','LP','KP','BP','SWAG','RUSH','ONEOPS','SP1'].map(e =>
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
        <div style="font-size:11px;color:var(--text3);margin-bottom:10px">Map <b>Amount</b> for a single column, or <b>Debit + Credit</b> for two-column bank statements.</div>
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

    const csvEntity = document.getElementById('csvEntitySelect')?.value;
    if (!csvEntity)           { this.toast('Select an entity');                return; }
    if (mapping.accDate < 0)  { this.toast('Date column is required');        return; }
    if (mapping.desc < 0)     { this.toast('Description column is required'); return; }
    if (mapping.amount < 0 && mapping.debit < 0 && mapping.credit < 0) {
      this.toast('Map either the Amount column or the Debit/Credit columns'); return;
    }

    const { rows } = this._csvImportData;
    const inserts = [];
    let skipped = 0;

    rows.forEach(row => {
      const accDate = this.normalizeDate(row[mapping.accDate]?.replace(/"/g, '').trim());
      // Clean description: strip trailing \EFFDAT and normalize whitespace
      const desc = row[mapping.desc]?.replace(/"/g, '').replace(/\s*\\EFFDAT\s*$/i, '').trim();

      let amount, direction;
      if (mapping.amount >= 0) {
        const rawAmt = row[mapping.amount]?.replace(/["$,\s]/g, '');
        const val = parseFloat(rawAmt);
        amount = Math.abs(val);
        // Use type column to determine direction if available (e.g. "ACH CREDIT", "MISCELLANEOUS DEBIT")
        if (mapping.type >= 0) {
          const typeStr = (row[mapping.type] || '').toUpperCase();
          if (typeStr.includes('CREDIT')) direction = 'CREDIT';
          else if (typeStr.includes('DEBIT')) direction = 'DEBIT';
        }
        // Fallback: positive = credit, negative = debit
        if (!direction) direction = val >= 0 ? 'CREDIT' : 'DEBIT';
      } else {
        const debitVal  = parseFloat(mapping.debit  >= 0 ? row[mapping.debit]?.replace(/["$,\s]/g,'')  || '0' : '0') || 0;
        const creditVal = parseFloat(mapping.credit >= 0 ? row[mapping.credit]?.replace(/["$,\s]/g,'') || '0' : '0') || 0;
        if (creditVal > 0)      { amount = creditVal; direction = 'CREDIT'; }
        else if (debitVal > 0)  { amount = debitVal;  direction = 'DEBIT';  }
        else                    { skipped++; return; }
      }

      if (!accDate || !desc || isNaN(amount) || amount === 0) { skipped++; return; }

      const bankAcct  = mapping.bankAccount   >= 0 ? row[mapping.bankAccount]?.replace(/"/g,'').trim()   || null : null;
      const acctNum   = mapping.accountNumber >= 0 ? row[mapping.accountNumber]?.replace(/"/g,'').trim() || null : null;
      inserts.push({
        description:      desc,
        amount,
        direction,
        transaction_date: accDate,
        accounting_date:  accDate,
        source:           'csv',
        classified:       false,
        entity_id:        window._entityByCode[csvEntity] || null,
        bank_account:     bankAcct,
        account_number:   acctNum
      });
    });

    if (!inserts.length) { this.toast('No valid rows to import'); return; }

    const { error } = await supabaseClient.from('raw_transactions').insert(inserts);
    if (error) { this.toast('Import failed — see console'); console.error(error); return; }

    this.closeModal();
    this.toast(`${inserts.length} transaction${inserts.length !== 1 ? 's' : ''} imported${skipped ? `, ${skipped} skipped` : ''}`);
    await this.navigate('inbox');
  },

  printReport() { window.print(); },

  // ---- CLOSE MONTH WORKFLOW ----
  async openCloseMonth() {
    const period = state.currentPeriod;
    const periodLabel = this.getPeriodLabel(period);
    const { data: txns, error } = await supabaseClient
      .from('transactions')
      .select('amount, accounts(account_type, account_subtype)')
      .gte('acc_date', period + '-01')
      .lte('acc_date', period + '-31');
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
      await supabaseClient.from('closed_periods').insert({ period, entity: state.currentEntity, closed_by: 'user' });
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
    const entityId    = state.currentEntity !== 'all' ? window._entityByCode?.[state.currentEntity] : null;

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

    const { error: lockErr } = await supabaseClient.from('closed_periods').insert({ period, entity: state.currentEntity, closed_by: 'user' });
    if (lockErr && lockErr.code !== '23505') { this.toast('Failed to lock period'); console.error(lockErr); return; }

    this.toast(`${periodLabel} closed ✓`);
    this.closeModal();
    await this.renderJournals();
  },

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

    ['m-revenue','m-income','m-gp','m-np','m-cash','m-adspend'].forEach(id => set(id, 0));
    if (!supabaseClient) return;

    const data = await this.fetchReportData(entity, period);
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
    set('m-income',  revenue);
    set('m-gp',      gp);
    set('m-np',      np);
    set('m-adspend', adSpend);
    set('m-cash',    0);

    const insights = document.getElementById('insightsSection');
    if (insights) {
      insights.innerHTML = data.txns.length === 0
        ? '<div class="insight-card" style="color:var(--text3)"><strong>No data for this period</strong><span>Import transactions in the Inbox to populate this dashboard.</span></div>'
        : '';
    }

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

    await this.updateDashboardCharts(data, entity, period);
  },

  async updateDashboardCharts(data, entity, period) {
    if (!state.charts || !data) return;
    const txns = data.txns || [];

    // --- Revenue bar chart: daily revenue vs expenses for current month ---
    const daysInMonth = new Date(parseInt(period.split('-')[0]), parseInt(period.split('-')[1]), 0).getDate();
    const dailyRevenue  = Array(daysInMonth).fill(0);
    const dailyExpenses = Array(daysInMonth).fill(0);
    for (const t of txns) {
      const day = parseInt((t.acc_date || '').split('-')[2] || '0') - 1;
      if (day < 0 || day >= daysInMonth) continue;
      const type = t.accounts?.account_type;
      const amt  = Number(t.amount);
      if (type === 'revenue') dailyRevenue[day]  += amt;
      else if (type === 'expense') dailyExpenses[day] += Math.abs(amt);
    }
    const dailyNet = dailyRevenue.map((r, i) => r - dailyExpenses[i]);
    if (state.charts.revenue) {
      const labels = Array.from({length: daysInMonth}, (_, i) => String(i + 1));
      state.charts.revenue.data.labels = labels;
      state.charts.revenue.data.datasets[0].data = dailyRevenue;
      state.charts.revenue.data.datasets[1].data = dailyExpenses;
      state.charts.revenue.data.datasets[2].data = dailyNet;
      state.charts.revenue.update();
    }

    // --- Expense donut: by subtype ---
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

    // --- Entity bar: revenue per entity for current period ---
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

    // --- Trend chart: last 6 months net profit + ad spend ---
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
      if (val === state.currentPeriod) opt.selected = true;
      picker.appendChild(opt);
    }
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
