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
  "ledger",
  "journals",
  "reconcile",
  "vendors",
  "invoices",
  "ap",
  "pnl",
  "balance",
  "cashflow",
  "forecast",
  "cash-balances",
  "ratios",
  "cfnotes",
  "sales",
  "productmix",
  "coa",
  "banks",
  "import",
  "admin-users",
] as const;
export type PageId = (typeof PAGES)[number];

/** Page → roles allowed to view it. */
export const PAGE_ACCESS: Record<PageId, readonly Role[]> = {
  dashboard:       ["coo", "admin"],
  inbox:           ["bookkeeper", "admin"],
  "cc-inbox":      ["bookkeeper", "admin"],
  ledger:          ["coo", "bookkeeper", "admin"],
  journals:        ["coo", "bookkeeper", "cpa", "admin"],
  reconcile:       ["coo", "bookkeeper", "admin"],
  vendors:         ["coo", "bookkeeper", "admin"],
  invoices:        ["coo", "bookkeeper", "admin"],
  ap:              ["coo", "cpa", "admin"],
  pnl:             ["coo", "cpa", "admin"],
  balance:         ["coo", "cpa", "admin"],
  cashflow:        ["coo", "cpa", "admin"],
  forecast:        ["coo", "admin"],
  "cash-balances": ["coo", "bookkeeper", "cpa", "admin"],
  ratios:          ["coo", "cpa", "admin"],
  cfnotes:         ["coo", "cpa", "admin"],
  sales:           ["coo", "admin"],
  productmix:      ["coo", "admin"],
  coa:             ["bookkeeper", "cpa", "admin"],
  banks:           ["coo", "admin"],
  import:          ["coo", "bookkeeper", "cpa", "admin"],
  "admin-users":   ["admin"],
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
  ledger: "/ledger",
  journals: "/journals",
  reconcile: "/reconcile",
  vendors: "/vendors",
  invoices: "/invoices",
  ap: "/ap",
  pnl: "/pnl",
  balance: "/balance",
  cashflow: "/cashflow",
  forecast: "/forecast",
  "cash-balances": "/cash-balances",
  ratios: "/ratios",
  cfnotes: "/cfnotes",
  sales: "/sales",
  productmix: "/productmix",
  coa: "/coa",
  banks: "/banks",
  import: "/import",
  "admin-users": "/admin/users",
};

/** Pretty labels used in the sidebar. */
export const PAGE_LABELS: Record<PageId, string> = {
  dashboard: "Dashboard",
  inbox: "Bank Transactions",
  "cc-inbox": "Credit Card Txns",
  ledger: "Ledger",
  journals: "Journal Entries",
  reconcile: "Reconciliation",
  vendors: "Vendors",
  invoices: "Invoices",
  ap: "AP / Payables",
  pnl: "Profit & Loss",
  balance: "Balance Sheet",
  cashflow: "Cash Flow",
  forecast: "Cash Forecast",
  "cash-balances": "Cash Balances",
  ratios: "Ratios & KPIs",
  cfnotes: "CFO Notes",
  sales: "Sales Metrics",
  productmix: "Product Mix",
  coa: "Chart of Accounts",
  banks: "Bank Connections",
  import: "Import Data",
  "admin-users": "Users",
};

/** Sidebar groups (label + ordered page ids). */
export const SIDEBAR_GROUPS: Array<{ label: string; pages: readonly PageId[] }> = [
  { label: "Overview", pages: ["dashboard"] },
  {
    label: "Accounting",
    pages: ["inbox", "cc-inbox", "ledger", "journals", "reconcile"],
  },
  { label: "Payables", pages: ["vendors", "invoices", "ap"] },
  {
    label: "Reports",
    pages: ["pnl", "balance", "cashflow", "forecast", "cash-balances", "ratios", "cfnotes"],
  },
  { label: "Sales", pages: ["sales", "productmix"] },
  { label: "Setup", pages: ["coa", "banks", "import"] },
  { label: "Admin", pages: ["admin-users"] },
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
