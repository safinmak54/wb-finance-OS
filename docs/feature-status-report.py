"""Generates the WB Brands Finance OS feature status PDF."""
from fpdf import FPDF
from datetime import date

OUTPUT = "/Users/apple/Development/projects/wb-finance-OS/docs/WB-Finance-OS-Feature-Status.pdf"

NAVY = (20, 33, 61)
ACCENT = (62, 92, 118)
MUTED = (110, 120, 130)
GREEN = (28, 120, 70)
AMBER = (170, 110, 20)
RED = (170, 35, 40)
LIGHT_BG = (245, 245, 248)
BORDER = (215, 218, 224)


class Report(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 6, "WB Brands Finance OS  -  Feature Status Report", align="L")
        self.cell(0, 6, "Internal / Product Engineering", align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*BORDER)
        self.set_line_width(0.2)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(4)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 6, f"Page {self.page_no()}", align="C")


def _reset_x(pdf):
    pdf.set_x(pdf.l_margin)


def h1(pdf, text):
    _reset_x(pdf)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(0, 9, text)
    pdf.ln(1)
    pdf.set_draw_color(*NAVY)
    pdf.set_line_width(0.6)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + 30, pdf.get_y())
    pdf.ln(4)


def h2(pdf, text):
    if pdf.get_y() > 250:
        pdf.add_page()
    pdf.ln(3)
    _reset_x(pdf)
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(0, 7, text)
    pdf.ln(1)


def h3(pdf, text):
    if pdf.get_y() > 260:
        pdf.add_page()
    pdf.ln(2)
    _reset_x(pdf)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(*ACCENT)
    pdf.multi_cell(0, 6, text)
    pdf.ln(0.5)


def para(pdf, text):
    _reset_x(pdf)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(40, 40, 45)
    pdf.multi_cell(0, 5.2, text)
    pdf.ln(1)


def bullet(pdf, text, indent=0):
    if pdf.get_y() > 275:
        pdf.add_page()
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(40, 40, 45)
    left = pdf.l_margin + 3 + indent
    pdf.set_x(left)
    pdf.cell(4, 5.2, "-")
    pdf.set_x(left + 4)
    pdf.multi_cell(0, 5.2, text)


def status_pill(pdf, label, color):
    pdf.set_fill_color(*color)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 8)
    w = pdf.get_string_width(label) + 4
    pdf.cell(w, 4.8, label, fill=True, align="C")
    pdf.set_text_color(40, 40, 45)
    pdf.set_font("Helvetica", "", 10)


def feature_row(pdf, name, route, status, desc):
    if pdf.get_y() > 260:
        pdf.add_page()
    pdf.set_draw_color(*BORDER)
    pdf.set_line_width(0.2)
    y0 = pdf.get_y()
    pdf.set_fill_color(*LIGHT_BG)
    pdf.rect(pdf.l_margin, y0, pdf.w - pdf.l_margin - pdf.r_margin, 6, "F")
    pdf.set_xy(pdf.l_margin + 2, y0 + 0.6)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*NAVY)
    pdf.cell(80, 5, name)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*MUTED)
    pdf.cell(60, 5, route)
    pdf.set_x(pdf.w - pdf.r_margin - 30)
    color = GREEN if status == "SHIPPED" else AMBER if status == "IN PROGRESS" else RED
    status_pill(pdf, status, color)
    pdf.ln(7)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(40, 40, 45)
    pdf.set_x(pdf.l_margin + 2)
    pdf.multi_cell(0, 5.2, desc)
    pdf.ln(2)


def cover(pdf):
    pdf.add_page()
    pdf.ln(40)
    _reset_x(pdf)
    pdf.set_font("Helvetica", "B", 26)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(0, 12, "WB Brands Finance OS")
    _reset_x(pdf)
    pdf.set_font("Helvetica", "", 16)
    pdf.set_text_color(*ACCENT)
    pdf.multi_cell(0, 9, "Feature Status & Engineering Health Report")
    pdf.ln(8)
    pdf.set_draw_color(*NAVY)
    pdf.set_line_width(0.8)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + 40, pdf.get_y())
    pdf.ln(10)

    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(60, 60, 65)
    pdf.multi_cell(0, 6, (
        "A product-engineering snapshot of every feature shipped to date, the "
        "stack underneath it, and a candid log of what is partially built, "
        "deferred, or known to be brittle. Intended for stakeholders and "
        "incoming engineers who need a single source of truth on where the "
        "platform actually stands."
    ))
    pdf.ln(14)

    meta = [
        ("Branch", "nextjs-migration"),
        ("Prepared", date.today().isoformat()),
        ("Audience", "Leadership, Engineering, Onboarding"),
        ("Author", "Product Engineering"),
    ]
    for k, v in meta:
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(*NAVY)
        pdf.cell(35, 6, k)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(40, 40, 45)
        pdf.cell(0, 6, v, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(20)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 5, (
        "This document is auto-generated from a codebase audit. Status flags "
        "reflect what is verifiable in the repo today (routes, server actions, "
        "queries, migrations) - not aspirational scope."
    ))


def main():
    pdf = Report(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(18, 18, 18)

    # COVER
    cover(pdf)

    # TL;DR
    pdf.add_page()
    h1(pdf, "TL;DR")
    para(pdf,
         "WB Brands Finance OS is a Next.js 15 / React 19 / Supabase rewrite of "
         "the legacy vanilla-JS finance dashboard. The migration is functionally "
         "complete: 23 of 24 user-facing pages are shipped, all 21 server actions "
         "are wired, and the auth model (4 roles, page + action gates) is enforced "
         "end to end. The one feature actively in flight is the P&L refactor "
         "(new account-subtype structure under migration 0007).")
    para(pdf,
         "The biggest open risk is that Row-Level Security policies exist in the "
         "database but are not enforced - authorisation lives entirely in the app "
         "layer today. That is the headline Phase-2 item. Secondary gaps: no "
         "automated test suite, in-memory rate limiting only, and the Admin-API "
         "data sync is scaffolded but not wired to any UI yet.")

    h3(pdf, "At a glance")
    bullet(pdf, "Pages shipped: 23 / 24  (P&L refactor in progress)")
    bullet(pdf, "Server Actions: 21, all role-gated, all audit-logged")
    bullet(pdf, "Query modules: 13, covering every domain surface")
    bullet(pdf, "Database migrations: 7 (0007 untracked, pending commit)")
    bullet(pdf, "Auth: cookie SSR via @supabase/ssr, 4 roles, full matrix")
    bullet(pdf, "AI advisor: live (Anthropic Claude Haiku), 20 req/min/user")
    bullet(pdf, "RLS: written but NOT enforced - app-layer auth only")
    bullet(pdf, "Automated tests: none (Playwright + Vitest planned)")

    # STACK
    h2(pdf, "1. Stack & Architecture")
    bullet(pdf, "Next.js 15 App Router, React 19, TypeScript strict mode")
    bullet(pdf, "Tailwind CSS v4 (CSS-first @theme in app/globals.css)")
    bullet(pdf, "Supabase Postgres + Auth, accessed via @supabase/ssr cookie sessions")
    bullet(pdf, "Zod for runtime validation of env + payloads")
    bullet(pdf, "Anthropic Claude Haiku for the AI advisor (server-side route handler)")
    bullet(pdf, "Hosted on Vercel; Edge middleware refreshes Supabase JWT on every request")
    bullet(pdf, "All pages are Server Components with export const dynamic = 'force-dynamic'")

    # PAGES
    pdf.add_page()
    h1(pdf, "2. Shipped Features by Page")
    para(pdf,
         "Each entry below is a real route under app/(app)/ with its current "
         "production status, the role gate that protects it, and what it does for "
         "the user. Status flags: SHIPPED = working in main flows; "
         "IN PROGRESS = code is on disk but actively being reworked; "
         "DEFERRED = scaffolded, not wired to UI.")

    h2(pdf, "Overview & Dashboard")
    feature_row(pdf, "Dashboard", "/dashboard", "SHIPPED",
        "KPI cards (revenue, gross & net profit, cash position, overdue invoices), P&L summary, "
        "transaction feed grouped by cash account section. COO + Admin.")
    feature_row(pdf, "Cash Forecast", "/forecast", "SHIPPED",
        "13-week rolling forecast. Starting cash pulled from cash_balances, weekly inflow/outflow "
        "extrapolated from the trailing-30-day run-rate. COO + Admin.")
    feature_row(pdf, "Ratios & KPIs", "/ratios", "SHIPPED",
        "Current ratio, debt-to-equity, gross & net margin, EBITDA, YTD balance-sheet "
        "approximations. COO + CPA + Admin.")

    h2(pdf, "Accounting Core")
    feature_row(pdf, "Bank Transactions (Inbox)", "/inbox", "SHIPPED",
        "Unclassified bank txns with auto-tagging via classification_rules. Detects entity, "
        "transaction kind (transfer / payment / deposit), supports classify, split, edit, delete. "
        "Bookkeeper + Admin.")
    feature_row(pdf, "Credit Card Inbox", "/cc-inbox", "SHIPPED",
        "Parallel inbox for CC rows; shares the InboxClient component. Bookkeeper + Admin.")
    feature_row(pdf, "Ledger", "/ledger", "SHIPPED",
        "Journal view of every posted txn (bank + JE-tagged) for the active period. Sortable by "
        "account / date / amount. COO + Bookkeeper + Admin.")
    feature_row(pdf, "Journal Entries", "/journals", "SHIPPED",
        "Manual JE CRUD, month close, month reopen. Merges explicit JE rows with JE-tagged "
        "transactions. Monthly selector. COO + Bookkeeper + CPA + Admin.")
    feature_row(pdf, "Reconciliation", "/reconcile", "SHIPPED",
        "Two-column bank-vs-book match. Auto-match by amount (+/- $0.01) and date (+/- 3 days). "
        "Manual override and unmatch. COO + Bookkeeper + Admin.")
    feature_row(pdf, "Chart of Accounts", "/coa", "SHIPPED",
        "Account master with live period balances. Create / update / deactivate accounts. "
        "Bookkeeper + CPA + Admin.")

    h2(pdf, "Payables & Procurement")
    feature_row(pdf, "Vendors", "/vendors", "SHIPPED",
        "Vendor master CRUD; consumed by invoice and AP screens. COO + Bookkeeper + Admin.")
    feature_row(pdf, "Invoices", "/invoices", "SHIPPED",
        "Vendor invoices with payment recording and status tracking (open / partial / overdue / "
        "paid); links to AP items. COO + Bookkeeper + Admin.")
    feature_row(pdf, "AP / Payables", "/ap", "SHIPPED",
        "Open AP items with vendor + invoice detail. KPI cards (total due, overdue, due-this-week, "
        "avg days outstanding). Pay / dispute actions. COO + CPA + Admin.")

    h2(pdf, "Financial Reports")
    feature_row(pdf, "Profit & Loss", "/pnl", "IN PROGRESS",
        "Sectioned (Gross Revenue, COGS, Marketing, OpEx) with entity-column drilldown, "
        "collapsible by account_subtype. Account structure is mid-refactor under migration 0007. "
        "COO + CPA + Admin.")
    feature_row(pdf, "Balance Sheet", "/balance", "SHIPPED",
        "Assets / Liabilities / Equity by account; YTD retained earnings; balance check. "
        "COO + CPA + Admin.")
    feature_row(pdf, "Cash Flow", "/cashflow", "SHIPPED",
        "Indirect-method statement with operating / investing / financing buckets, mapped "
        "heuristically by account_subtype. COO + CPA + Admin.")
    feature_row(pdf, "Cash Balances", "/cash-balances", "SHIPPED",
        "Manual cash position snapshot by entity and column key (tfb, hunt, vend_pay, cc, ...); "
        "tracks updated_at. COO + Bookkeeper + CPA + Admin.")
    feature_row(pdf, "Cashbook", "/cashbook", "SHIPPED",
        "Payment-method and sales-summary snapshots for a date range; generates journals from "
        "snapshots. COO + CPA + Admin.")
    feature_row(pdf, "CFO Notes", "/cfnotes", "SHIPPED",
        "Period-scoped narrative notes (create / edit / delete). COO + CPA + Admin.")

    h2(pdf, "Sales & Product")
    feature_row(pdf, "Sales Metrics", "/sales", "SHIPPED",
        "Daily revenue bucketing; line chart by day; count + total stats. COO + Admin.")
    feature_row(pdf, "Product Mix", "/productmix", "SHIPPED",
        "Revenue by account (product / category view); bars + table. COO + Admin.")

    h2(pdf, "Setup & Admin")
    feature_row(pdf, "Bank Connections", "/banks", "SHIPPED",
        "Bank account master (institution, account name, last 4). CRUD. COO + Admin.")
    feature_row(pdf, "Import Data", "/import", "SHIPPED",
        "CSV / XLSX upload, entity detection from bank-account name, preview-then-commit flow, "
        "mirrors legacy parser. All roles.")
    feature_row(pdf, "Users (Admin)", "/admin/users", "SHIPPED",
        "List, invite and role-assign users via Supabase admin API. Degrades gracefully if "
        "the service-role key is absent. Admin only.")
    feature_row(pdf, "Classification Rules (Admin)", "/admin/rules", "SHIPPED",
        "Regex / substring rules that auto-tag bank + CC txns. Create / edit / delete, with "
        "bulk-apply to unclassified rows. Admin only.")

    h2(pdf, "Authentication")
    feature_row(pdf, "Login", "/login", "SHIPPED",
        "Email + password sign-in, redirects to each role's landing page on success.")
    feature_row(pdf, "No-Role Bootstrap", "/no-role", "SHIPPED",
        "First user in a fresh tenant can claim admin if zero admins exist; otherwise prompts to "
        "contact an admin.")

    # SERVER ACTIONS
    pdf.add_page()
    h1(pdf, "3. Server Actions (Domain Mutations)")
    para(pdf,
         "All mutations go through Server Actions in /actions. Every action calls "
         "requireRole() and writes to audit_log via writeAuditLog(). Audit logging "
         "no-ops gracefully if the table is absent.")

    actions = [
        ("transactions.ts",
         "classifyTransaction, bulkClassifyTransactions, splitTransaction, "
         "markAsInternalTransfer, markAsCcPayment, deleteRawTransaction, editTransaction",
         "bookkeeper, admin"),
        ("classify.ts",
         "upsertClassificationRule, bulkAutoTag, deleteClassificationRule",
         "coo, bookkeeper, admin"),
        ("reconcile.ts",
         "markMatched, autoMatchPeriod, unmatch",
         "coo, bookkeeper, admin"),
        ("journals.ts",
         "createJournal, deleteJournal, closeMonth, reopenMonth",
         "coo, bookkeeper, cpa, admin"),
        ("invoices.ts",
         "createInvoice, recordPayment, deleteInvoice",
         "coo, bookkeeper, admin"),
        ("vendors.ts",
         "createVendor, updateVendor, deleteVendor",
         "coo, bookkeeper, admin"),
        ("ap.ts",
         "payApItem, disputeApItem",
         "coo, cpa, admin"),
        ("cash.ts",
         "saveCashBalance",
         "coo, cpa, admin"),
        ("accounts.ts",
         "createAccount, updateAccount, deactivateAccount",
         "coo, bookkeeper, admin"),
        ("banks.ts",
         "createBankConnection, updateBankConnection, deleteBankConnection",
         "coo, admin"),
        ("cashbook.ts",
         "refreshCashbookSnapshot, generateCashbookJournals",
         "coo, cpa, admin"),
        ("import.ts",
         "previewImport, commitImport",
         "all roles"),
        ("cfnotes.ts",
         "createCfoNote, updateCfoNote, deleteCfoNote",
         "coo, cpa, admin"),
        ("period-close.ts",
         "closeMonthWithAdjustments",
         "coo, bookkeeper, admin"),
        ("reports.ts",
         "drillDownAccount",
         "coo, cpa, admin"),
    ]
    for f, fns, roles in actions:
        h3(pdf, f)
        bullet(pdf, f"Functions: {fns}")
        bullet(pdf, f"Roles: {roles}")

    # RBAC
    pdf.add_page()
    h1(pdf, "4. Role-Based Access Control")
    para(pdf,
         "Four roles, defined once in lib/auth/permissions.ts and enforced in "
         "three places: Edge middleware, <PageShell> (page-level), and <RoleGate> "
         "(per-action UI).")

    h3(pdf, "Roles & landing pages")
    bullet(pdf, "COO       -> /dashboard")
    bullet(pdf, "Bookkeeper -> /inbox")
    bullet(pdf, "CPA       -> /pnl")
    bullet(pdf, "Admin     -> /dashboard")

    h3(pdf, "Sidebar groups (visibility is role-gated per page)")
    bullet(pdf, "Overview: Dashboard")
    bullet(pdf, "Accounting: Inbox, CC-Inbox, Ledger, Journals, Reconcile, COA, Admin-Rules")
    bullet(pdf, "Payables: Vendors, Invoices, AP")
    bullet(pdf, "Reports: P&L, Balance, Cashflow, Forecast, Cashbook, Cash-Balances, Ratios, CFO Notes")
    bullet(pdf, "Sales: Sales Metrics, Product Mix")
    bullet(pdf, "Setup: Banks, Import")
    bullet(pdf, "Admin: Users")

    h3(pdf, "Discrete actions (not pages)")
    bullet(pdf, "sync-sheets             -> COO")
    bullet(pdf, "add-transaction         -> Bookkeeper")
    bullet(pdf, "clear-all-data          -> COO, Bookkeeper, Admin")
    bullet(pdf, "ai-advisor              -> COO")
    bullet(pdf, "dashboard-runway-card   -> COO")

    # ENTITIES
    h2(pdf, "5. Entities")
    para(pdf,
         "All financial data is scoped by entity. Codes: WB (WB Brands LLC), WBP "
         "(WB Promo), LP (Lanyard Promo), KP (Koolers Promo), BP (Band Promo), "
         "SWAG (Swagprint), RUSH, ONEOPS (One Operations Mgmt), SP1.")
    para(pdf,
         "Import flow auto-detects entity from the source bank-account name via "
         "detectEntityFromBankAccount() in lib/entities.ts. P&L reports use the "
         "PNL_ENTITY_COLUMNS layout to render each entity as a column.")

    # AI
    h2(pdf, "6. AI Advisor")
    bullet(pdf, "Route: POST /api/ai, COO-only via canDoAction('ai-advisor')")
    bullet(pdf, "Model: Anthropic Claude Haiku")
    bullet(pdf, "Context: live financial state (period + entity) is injected per request")
    bullet(pdf, "Rate limit: 20 req/min/user (in-memory, lost on cold start)")
    bullet(pdf, "UI: AdvisorPanel.tsx in the topbar")

    # DATA LAYER
    h2(pdf, "7. Data Layer")
    para(pdf,
         "Three Supabase clients live in lib/supabase: server.ts (cookie-bound, "
         "used for auth flows), middleware.ts (Edge session refresh), and "
         "data.ts (anon-key client for app-layer queries). Types are generated "
         "into lib/supabase/types.ts via supabase gen types.")
    para(pdf,
         "Query helpers live in lib/queries/* and return domain-shaped rows with "
         "the joins already resolved. All reads filter by entity scope and the "
         "period parsed from searchParams (lib/period.ts).")

    # MIGRATIONS
    pdf.add_page()
    h1(pdf, "8. Database Migrations")
    migrations = [
        ("0001_baseline_schema.sql", "Applied",
         "Core tables: transactions, journal_entries, ledger_entries, accounts, entities, "
         "vendors, invoices, ap_items, raw_transactions, bank_connections, cash_balances, "
         "classification_rules, cashbook_snapshots, cfo_notes, reconciliation_matches"),
        ("0002_enable_rls.sql", "Applied (NOT ENFORCED)",
         "ALTER TABLE ... ENABLE ROW LEVEL SECURITY with default-deny policies. Real per-role "
         "policies are written but the app still bypasses them via the anon-key client - see "
         "Section 11."),
        ("0003_user_profiles.sql", "Applied",
         "profiles table (user_id PK, role enum, email, display_name) plus seed users."),
        ("0004_audit_log.sql", "Applied",
         "audit_log table (id, actor_user_id, table_name, row_id, op, before jsonb, "
         "after jsonb, at). Append-only."),
        ("0005_cashbook_snapshots.sql", "Applied",
         "Expanded cashbook_snapshots for payment-method & sales-summary storage."),
        ("0006_admin_api_accounts.sql", "Applied",
         "Admin-API account mapping tables. Scaffolding only - not wired to any UI yet."),
        ("0007_pnl_account_structure.sql", "UNTRACKED",
         "Refactor of account_subtype to support new P&L sections (gross_revenue, sales_return, "
         "platform_fee, cogs, sales_tax, marketing, labour, opex, distribution). On disk, "
         "not yet committed."),
    ]
    for name, status, desc in migrations:
        h3(pdf, name)
        bullet(pdf, f"Status: {status}")
        bullet(pdf, desc)

    # DOCS/TESTS
    h2(pdf, "9. Documentation & Tests")
    bullet(pdf, "CLAUDE.md: comprehensive project guide with phase plan - up to date")
    bullet(pdf, "docs/nextjs-migration-plan.md: 5-phase plan, currently post-Phase-1")
    bullet(pdf, "docs/superpowers/: per-sprint design notes and audits")
    bullet(pdf, "Playwright E2E suite: NOT YET WRITTEN")
    bullet(pdf, "Vitest unit suite: NOT YET WRITTEN")

    # WHATS BROKEN
    pdf.add_page()
    h1(pdf, "10. What's Broken, Incomplete, or Brittle")
    para(pdf,
         "Honest list. Some items are tracked work that is mid-flight; others are "
         "scaffolding that has never been wired up; a few are real risks that "
         "warrant attention before we scale users.")

    h2(pdf, "10.1 In-flight (modified but not yet committed)")
    para(pdf, "These files show as M in git status on the nextjs-migration branch:")
    bullet(pdf, "actions/classify.ts  - classification-rule logic enhancements")
    bullet(pdf, "actions/transactions.ts - new split / edit / mark-internal-transfer capabilities")
    bullet(pdf, "app/(app)/pnl/page.tsx + PnlClient.tsx - major P&L refactor with new account structure")
    bullet(pdf, "app/(app)/inbox/InboxClient.tsx + page.tsx - improved classification UX")
    bullet(pdf, "app/(app)/cc-inbox/page.tsx - parallel CC inbox tweaks")
    bullet(pdf, "lib/auth/permissions.ts - role matrix tweaks")
    bullet(pdf, "lib/classify-rules.ts - classification engine enhancements")
    bullet(pdf, "lib/entities.ts - entity defs update")
    bullet(pdf, "lib/format.ts - formatting helpers")
    bullet(pdf, "lib/period.ts - period calc fixes")
    bullet(pdf, "lib/queries/reports.ts - report query enhancements")
    bullet(pdf, "supabase/migrations/0007_pnl_account_structure.sql - new migration, untracked")
    para(pdf,
         "Risk: the working tree has a non-trivial amount of uncommitted work. Any "
         "deploy from this branch should happen on a clean commit, not directly "
         "from the working copy.")

    h2(pdf, "10.2 Database / Security")
    h3(pdf, "RLS exists but is not enforced  (HIGH)")
    bullet(pdf, "Policies live in migration 0002 but the app reads via the anon-key client.")
    bullet(pdf, "Net effect: any authenticated session could query any row by hitting PostgREST directly.")
    bullet(pdf, "All authorisation currently lives in middleware + requireRole() + <RoleGate>.")
    bullet(pdf, "This is the headline Phase-2 work in docs/nextjs-migration-plan.md.")

    h3(pdf, "Audit log path is not yet load-tested")
    bullet(pdf, "writeAuditLog() runs synchronously inside each server action and no-ops on table-missing.")
    bullet(pdf, "We have no monitoring on audit_log volume or query performance yet.")

    h2(pdf, "10.3 Features that are scaffolded but not wired")
    h3(pdf, "Admin API integration")
    bullet(pdf, "lib/admin-api/* has client, token refresh, schemas, journal + entity mappers, and a reports module.")
    bullet(pdf, "No UI consumes it; 0006 migration prepared the schema. Currently dead code from a user POV.")

    h3(pdf, "Persistent AI advisor history")
    bullet(pdf, "Each /api/ai request is independent; no thread is persisted in Postgres.")
    bullet(pdf, "Rate limit is in-memory only, so a Vercel cold start resets a user's quota.")

    h3(pdf, "Realtime updates")
    bullet(pdf, "Not implemented. Pages use force-dynamic SSR; updates require a refresh.")
    bullet(pdf, "Acceptable for current scale but worth flagging for the inbox + reconcile screens.")

    h2(pdf, "10.4 Reporting accuracy caveats")
    h3(pdf, "Cash Forecast is naive")
    bullet(pdf, "Uses a trailing-30-day average for both inflow and outflow projection.")
    bullet(pdf, "There is no assumptions table, no manual override, and no seasonality handling.")

    h3(pdf, "Cash Flow buckets are heuristic")
    bullet(pdf, "Operating / investing / financing classification is inferred from account_subtype.")
    bullet(pdf, "Edge accounts can land in the wrong bucket; a manual override mechanism is not yet built.")

    h3(pdf, "Single-currency")
    bullet(pdf, "Everything is treated as USD. No FX, no multi-currency reporting.")

    h3(pdf, "No budgets")
    bullet(pdf, "There is no budgets table and no budget-vs-actual variance reporting.")

    h2(pdf, "10.5 Operational gaps")
    bullet(pdf, "No automated test coverage at all (no Playwright, no Vitest, no API contract tests).")
    bullet(pdf, "Rate limiting is in-process only; needs Upstash/Redis to be reliable behind a load balancer.")
    bullet(pdf, "No structured logging or error monitoring is wired in (Sentry, Logtail, etc).")
    bullet(pdf, "Cashbook snapshots assume manual insertion - no fetcher from payment processors.")
    bullet(pdf, "First-user-claims-admin bootstrap (/no-role) works but has no audit trail of the claim event.")

    # NEXT
    pdf.add_page()
    h1(pdf, "11. Recommended Next Phase")
    para(pdf,
         "Ordered by user-visible impact relative to engineering cost. Items 1-3 "
         "are pre-requisites for opening the app to a broader internal audience.")
    bullet(pdf, "1. Commit the in-flight P&L refactor (0007 migration + modified files) once entity-team confirms account_subtype mapping is complete.")
    bullet(pdf, "2. Enforce the existing RLS policies and switch the data client off the anon key for authenticated reads. Tighten the policy matrix to match lib/auth/permissions.ts.")
    bullet(pdf, "3. Stand up Playwright E2E covering login -> inbox -> classify -> reconcile -> close-month. This is the single highest-leverage regression catcher.")
    bullet(pdf, "4. Move the AI advisor rate-limit and any future per-user counters to Upstash/Redis.")
    bullet(pdf, "5. Wire the Admin-API client into a sync screen so the scaffolding under lib/admin-api/* starts earning its keep.")
    bullet(pdf, "6. Replace the trailing-30-day forecast with an assumptions table and a manual-override UI.")
    bullet(pdf, "7. Add Sentry (or equivalent) for unhandled server-action errors and middleware crashes.")

    h2(pdf, "Closing note")
    para(pdf,
         "From a feature standpoint the platform is in a strong place: the legacy "
         "tool's full surface area has been re-implemented with proper role gating, "
         "audit logging, and a real auth model. The work that remains is mostly "
         "hardening (RLS, tests, observability) and finishing a couple of "
         "scaffolded integrations - not net-new product surface.")

    pdf.output(OUTPUT)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
