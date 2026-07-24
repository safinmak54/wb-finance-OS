/**
 * Role-based access matrix.
 *
 * Source of truth: extracted from `data-roles="…"` attributes in
 * legacy/index.html and the `_applyRole` function in legacy/app.js.
 * The behavior here intentionally matches the legacy app 1:1 so the
 * migration is a refactor, not a redesign of who-sees-what.
 *
 * Two layers consume this module:
 *   1. middleware.ts             — server-side route gate
 *   2. app/(app)/layout.tsx      — sidebar nav filtering + default redirect
 *   3. components/auth/RoleGate  — per-element gating for action buttons
 */

export const ROLES = ["coo", "bookkeeper", "cpa", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** All app routes that show in the sidebar plus modal-only entries. */
export const PAGES = [
  "dashboard",
  "inbox",
  "cc-inbox",
  "cashbook-inbox",
  "ledger",
  "journals",
  "reconcile",
  "vendors",
  "invoices",
  "ap",
  "pnl",
  "balance",
  "trial-balance",
  "cashflow",
  "forecast",
  "cash-balances",
  "cashbook",
  "ratios",
  "cfnotes",
  "sales",
  "productmix",
  "coa",
  "banks",
  "import",
  "admin-users",
  "admin-rules",
] as const;
export type PageId = (typeof PAGES)[number];

/** Page → roles allowed to view it. */
export const PAGE_ACCESS: Record<PageId, readonly Role[]> = {
  dashboard:       ["coo", "admin"],
  inbox:           ["bookkeeper", "admin"],
  "cc-inbox":      ["bookkeeper", "admin"],
  "cashbook-inbox": ["bookkeeper", "admin"],
  ledger:          ["coo", "bookkeeper", "admin"],
  journals:        ["coo", "bookkeeper", "cpa", "admin"],
  reconcile:       ["coo", "bookkeeper", "admin"],
  vendors:         ["coo", "bookkeeper", "admin"],
  invoices:        ["coo", "bookkeeper", "admin"],
  ap:              ["coo", "cpa", "admin"],
  pnl:             ["coo", "cpa", "admin"],
  balance:         ["coo", "cpa", "admin"],
  "trial-balance": ["coo", "cpa", "admin"],
  cashflow:        ["coo", "cpa", "admin"],
  forecast:        ["coo", "admin"],
  "cash-balances": ["coo", "bookkeeper", "cpa", "admin"],
  cashbook:        ["coo", "cpa", "admin"],
  ratios:          ["coo", "cpa", "admin"],
  cfnotes:         ["coo", "cpa", "admin"],
  sales:           ["coo", "admin"],
  productmix:      ["coo", "admin"],
  coa:             ["bookkeeper", "cpa", "admin"],
  banks:           ["coo", "admin"],
  import:          ["coo", "bookkeeper", "cpa", "admin"],
  "admin-users":   ["admin"],
  // Classification Rules is an Epic-1 "Reference" page: viewable + editable by
  // accounting users, so it matches the Chart of Accounts (`coa`) access set
  // rather than being admin-only.
  "admin-rules":   ["bookkeeper", "cpa", "admin"],
};

/** Discrete capabilities (topbar buttons, dashboard cards, etc.). */
export const ACTIONS = [
  "sync-sheets",
  "add-transaction",
  "clear-all-data",
  "ai-advisor",
  "dashboard-runway-card",
] as const;
export type ActionId = (typeof ACTIONS)[number];

export const ACTION_ACCESS: Record<ActionId, readonly Role[]> = {
  "sync-sheets":            ["coo"],
  "add-transaction":        ["bookkeeper"],
  "clear-all-data":         ["coo", "bookkeeper", "admin"],
  "ai-advisor":             ["coo"],
  "dashboard-runway-card":  ["coo"],
};

/** Where each role lands after login. */
export const DEFAULT_LANDING: Record<Role, PageId> = {
  coo: "dashboard",
  bookkeeper: "inbox",
  cpa: "pnl",
  admin: "dashboard",
};

/** URL pathnames in the (app) group, keyed by PageId. */
export const PAGE_PATHS: Record<PageId, string> = {
  dashboard: "/dashboard",
  inbox: "/inbox",
  "cc-inbox": "/cc-inbox",
  "cashbook-inbox": "/cashbook-inbox",
  ledger: "/ledger",
  journals: "/journals",
  reconcile: "/reconcile",
  vendors: "/vendors",
  invoices: "/invoices",
  ap: "/ap",
  pnl: "/pnl",
  balance: "/balance",
  "trial-balance": "/trial-balance",
  cashflow: "/cashflow",
  forecast: "/forecast",
  "cash-balances": "/cash-balances",
  cashbook: "/cashbook",
  ratios: "/ratios",
  cfnotes: "/cfnotes",
  sales: "/sales",
  productmix: "/productmix",
  coa: "/coa",
  banks: "/banks",
  import: "/import",
  "admin-users": "/admin/users",
  "admin-rules": "/admin/rules",
};

/** Pretty labels used in the sidebar. */
export const PAGE_LABELS: Record<PageId, string> = {
  dashboard: "Key Metrics",
  inbox: "Bank Transactions",
  "cc-inbox": "Credit Card Transactions",
  "cashbook-inbox": "Cashbook Transactions",
  ledger: "Ledger",
  journals: "Manual Journal Entries",
  reconcile: "ACH/Checks/Wire Reconciliation",
  vendors: "Vendors",
  invoices: "Invoices",
  ap: "AP / Payables",
  pnl: "Income Statement",
  balance: "Balance Sheet",
  "trial-balance": "Trial Balance",
  cashflow: "Cash Flow",
  forecast: "Cash Forecast",
  "cash-balances": "Cash Balances",
  cashbook: "Cashbook",
  ratios: "Ratios & KPIs",
  cfnotes: "CFO Notes",
  sales: "Sales Metrics",
  productmix: "Product Mix",
  coa: "Chart of Accounts",
  banks: "Bank Connections",
  import: "Import Data",
  "admin-users": "Users",
  "admin-rules": "Classification Rules",
};

/**
 * Sidebar groups (label + ordered page ids).
 *
 * These are the five Epic 1 sections and only those. Every other page is
 * intentionally hidden from the sidebar for now — the routes still exist and
 * stay reachable by URL (and role-gated via PAGE_ACCESS), they just don't
 * render in the nav. Pages currently hidden: ledger, cashbook, cash-balances,
 * vendors, invoices, ap, forecast, ratios, cfnotes, sales, productmix, banks,
 * import, admin-users. Re-add any of them to a group below to surface it.
 */
export const SIDEBAR_GROUPS: Array<{ label: string; pages: readonly PageId[] }> = [
  { label: "Dashboard", pages: ["dashboard"] },
  { label: "Accounting", pages: ["reconcile", "journals"] },
  { label: "Reports", pages: ["pnl", "balance", "trial-balance", "cashflow"] },
  { label: "Banking", pages: ["inbox", "cc-inbox", "cashbook-inbox"] },
  { label: "Reference", pages: ["admin-rules", "coa"] },
];

// ---------- helpers ----------

export function canViewPage(role: Role | null, page: PageId): boolean {
  if (!role) return false;
  return PAGE_ACCESS[page].includes(role);
}

export function canDoAction(role: Role | null, action: ActionId): boolean {
  if (!role) return false;
  return ACTION_ACCESS[action].includes(role);
}

export function pageIdFromPathname(pathname: string): PageId | null {
  const trimmed = pathname.replace(/\/+$/, "");
  for (const id of PAGES) {
    if (trimmed === PAGE_PATHS[id]) return id;
  }
  return null;
}

export function landingPathFor(role: Role): string {
  return PAGE_PATHS[DEFAULT_LANDING[role]];
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
