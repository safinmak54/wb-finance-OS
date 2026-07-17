import type { Account } from "@/lib/supabase/types";

/**
 * Balance-sheet presentation structure.
 *
 * The GL is a flat chart of accounts; this module groups those accounts into
 * the management balance-sheet categories the COO reads:
 *
 *   ASSETS                       LIABILITIES
 *     Cash                         A/P — COGS
 *     Accounts Receivable          A/P — Marketing
 *       (by payment method)        A/P — Salaries
 *     Inventory & Prepaid          A/P — Others (credit cards …)
 *     Other assets               OWNER'S EQUITY
 *                                  Retained Earnings
 *                                  Net Income
 *                                  Owner's Distribution
 *
 * Like `lib/pnl/structure.ts`, the account-code → category map is an explicit
 * hardcoded list rather than derived from `accounts.account_subtype` (that
 * column is inconsistent — mixes "current"/"Asset"/"asset", tags ad-clearing
 * assets as "marketing", etc.). Anything not explicitly mapped falls back to a
 * catch-all bucket for its `account_type`, so a new GL account is NEVER
 * silently dropped and the sheet keeps tying out.
 *
 * IMPORTANT: this module only regroups accounts — it does not change any
 * signed amount. Each account's displayed value uses the exact convention the
 * balance page already used (`asset → -rawSum`, `liability/equity → +rawSum`),
 * so Total Assets / Liabilities / Equity are identical to the previous layout
 * and the accounting equation balances exactly as before.
 */

export type BalanceGroupKey =
  | "cash"
  | "ar_stripe"
  | "ar_paypal"
  | "ar_wires"
  | "inventory_prepaid"
  | "other_assets"
  | "ap_cogs"
  | "ap_marketing"
  | "ap_salaries"
  | "ap_others"
  | "retained_earnings"
  | "owner_capital"
  | "distribution"
  | "other_equity";

// Cash / bank accounts (1010–1050: LP, KP, BP, WBP, One Ops checking).
const CASH = new Set(["1010", "1020", "1030", "1040", "1050"]);

// Accounts receivable, split by the payment method the money is in transit
// through. These are the processor "clearing" accounts (money owed to us that
// hasn't settled to a bank account yet). Duplicated codes (1100/1140 Stripe,
// 1105/1150 PayPal) are folded into a single per-method line.
const AR_STRIPE = new Set(["1100", "1140"]);
const AR_PAYPAL = new Set(["1105", "1150"]);
const AR_WIRES = new Set(["1110"]);

const INVENTORY_PREPAID = new Set(["1200", "1300"]);

// Accounts payable buckets. 2010 is literally "Accounts payable - COGS" and
// 2100 is "Payroll liabilities" (salaries). There is no marketing-payable GL
// account yet — the bucket is kept in the layout (per the target format) and
// reads $0 until marketing A/P is tracked in the ledger. Everything else
// liability (credit cards 2400/2410/2420, accrued 2200, intercompany 2300)
// falls into "Others".
const AP_COGS = new Set(["2010"]);
const AP_MARKETING = new Set<string>([]);
const AP_SALARIES = new Set(["2100"]);

const RETAINED = new Set(["3020"]);
const OWNER_CAPITAL = new Set(["3010"]);
// 3030 Partner distributions + 3100 Owner Distribution — money taken out by
// owners; debit-normal, so shown in parentheses (subtracts from equity).
const DISTRIBUTION = new Set(["3030", "3100"]);

/**
 * Map an account to its balance-sheet category. Returns null for
 * revenue/expense accounts, which never appear on the balance sheet (their net
 * flows through Net Income in the equity section instead).
 */
export function balanceGroupFor(a: BalanceAccountMeta): BalanceGroupKey | null {
  const code = a.account_code;
  switch (a.account_type) {
    case "asset":
      if (CASH.has(code)) return "cash";
      if (AR_STRIPE.has(code)) return "ar_stripe";
      if (AR_PAYPAL.has(code)) return "ar_paypal";
      if (AR_WIRES.has(code)) return "ar_wires";
      if (INVENTORY_PREPAID.has(code)) return "inventory_prepaid";
      return "other_assets";
    case "liability":
      if (AP_COGS.has(code)) return "ap_cogs";
      if (AP_MARKETING.has(code)) return "ap_marketing";
      if (AP_SALARIES.has(code)) return "ap_salaries";
      return "ap_others";
    case "equity":
      if (RETAINED.has(code)) return "retained_earnings";
      if (OWNER_CAPITAL.has(code)) return "owner_capital";
      if (DISTRIBUTION.has(code)) return "distribution";
      return "other_equity";
    default:
      return null;
  }
}

export type BalanceAccountMeta = Pick<
  Account,
  "id" | "account_code" | "account_name" | "account_type"
>;

export type BalanceLine = {
  label: string;
  amount: number;
  /** Secondary note (e.g. "Not yet tracked in the ledger"). */
  note?: string;
};

/** A titled sub-section with its own detail lines and a subtotal. */
export type BalanceGroupRow = {
  kind: "group";
  title: string;
  lines: BalanceLine[];
  subtotal: number;
};

/** A single labelled line (no nested detail). */
export type BalanceLineRow = {
  kind: "line";
  label: string;
  amount: number;
  note?: string;
};

export type BalanceRow = BalanceGroupRow | BalanceLineRow;

export type BalanceSection = {
  title: string;
  totalLabel: string;
  rows: BalanceRow[];
  total: number;
};

export type BalanceSheetModel = {
  assets: BalanceSection;
  liabilities: BalanceSection;
  equity: BalanceSection;
};

/** Displayed value for one account, matching the balance page's convention:
 *  assets show the debit balance (−rawSum), liabilities/equity show the credit
 *  balance (+rawSum). `rawSum` is Σ of signed `transactions.amount`. */
function displayValue(a: BalanceAccountMeta, rawSum: number): number {
  return a.account_type === "asset" ? -rawSum : rawSum;
}

/** Strip the redundant "Cash — " / "Credit card payable — " prefix so lines
 *  read cleanly under their category header. */
function shortLabel(name: string): string {
  return name.replace(/^.*?—\s*/, "").trim() || name;
}

/**
 * Build the full categorized balance-sheet model from per-account raw sums.
 *
 * @param accounts   every account to place (active ∪ has-a-balance)
 * @param totalsById Σ signed `transactions.amount` per account id
 * @param netIncome  current-period net income (revenue − expense), added as a
 *                   dedicated equity line separate from accumulated retained
 *                   earnings
 */
export function buildBalanceSheetModel(
  accounts: readonly BalanceAccountMeta[],
  totalsById: ReadonlyMap<string, number>,
  netIncome: number,
): BalanceSheetModel {
  const byGroup = new Map<BalanceGroupKey, BalanceAccountMeta[]>();
  for (const a of accounts) {
    const g = balanceGroupFor(a);
    if (!g) continue;
    const list = byGroup.get(g);
    if (list) list.push(a);
    else byGroup.set(g, [a]);
  }

  const val = (a: BalanceAccountMeta) => displayValue(a, totalsById.get(a.id) ?? 0);
  const sumGroup = (g: BalanceGroupKey) =>
    (byGroup.get(g) ?? []).reduce((s, a) => s + val(a), 0);

  // Detail lines for a group: one per account, biggest first, zeros hidden
  // (the group subtotal already reflects them, so hiding zeros only declutters).
  const linesFor = (g: BalanceGroupKey, label: (a: BalanceAccountMeta) => string) =>
    (byGroup.get(g) ?? [])
      .map((a) => ({ label: label(a), amount: val(a) }))
      .filter((l) => l.amount !== 0)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ---- Assets ----
  const cashLines = linesFor("cash", (a) => shortLabel(a.account_name));
  const cashTotal = sumGroup("cash");

  const arStripe = sumGroup("ar_stripe");
  const arPaypal = sumGroup("ar_paypal");
  const arWires = sumGroup("ar_wires");
  const arTotal = arStripe + arPaypal + arWires;
  const arLines: BalanceLine[] = [
    { label: "Stripe", amount: arStripe },
    { label: "PayPal", amount: arPaypal },
    { label: "Wires / Checks", amount: arWires },
  ].filter((l) => l.amount !== 0);

  const invLines = linesFor("inventory_prepaid", (a) => a.account_name);
  const invTotal = sumGroup("inventory_prepaid");

  const otherAssetLines = linesFor("other_assets", (a) => a.account_name);
  const otherAssetTotal = sumGroup("other_assets");

  const assetTotal = cashTotal + arTotal + invTotal + otherAssetTotal;

  const assetRows: BalanceRow[] = [
    { kind: "group", title: "Cash", lines: cashLines, subtotal: cashTotal },
    {
      kind: "group",
      title: "Accounts Receivable",
      lines: arLines,
      subtotal: arTotal,
    },
    {
      kind: "group",
      title: "Inventory & Prepaid Expenses",
      lines: invLines,
      subtotal: invTotal,
    },
  ];
  if (otherAssetLines.length > 0) {
    assetRows.push({
      kind: "group",
      title: "Other Assets",
      lines: otherAssetLines,
      subtotal: otherAssetTotal,
    });
  }

  // ---- Liabilities ----
  const apCogs = sumGroup("ap_cogs");
  const apMarketing = sumGroup("ap_marketing");
  const apSalaries = sumGroup("ap_salaries");
  const apOthersLines = linesFor("ap_others", (a) => shortLabel(a.account_name));
  const apOthers = sumGroup("ap_others");
  const liabilityTotal = apCogs + apMarketing + apSalaries + apOthers;

  const liabilityRows: BalanceRow[] = [
    { kind: "line", label: "Accounts Payable — COGS", amount: apCogs },
    {
      kind: "line",
      label: "Accounts Payable — Marketing",
      amount: apMarketing,
      note: apMarketing === 0 ? "Not yet tracked in the ledger" : undefined,
    },
    { kind: "line", label: "Accounts Payable — Salaries", amount: apSalaries },
    {
      kind: "group",
      title: "Accounts Payable — Others",
      lines: apOthersLines,
      subtotal: apOthers,
    },
  ];

  // ---- Owner's Equity ----
  const retained = sumGroup("retained_earnings");
  const ownerCapital = sumGroup("owner_capital") + sumGroup("other_equity");
  const distribution = sumGroup("distribution");
  const equityTotal = retained + netIncome + ownerCapital + distribution;

  const equityRows: BalanceRow[] = [];
  if (ownerCapital !== 0) {
    equityRows.push({ kind: "line", label: "Owner's Capital", amount: ownerCapital });
  }
  equityRows.push({ kind: "line", label: "Retained Earnings", amount: retained });
  equityRows.push({ kind: "line", label: "Net Income", amount: netIncome });
  equityRows.push({
    kind: "line",
    label: "Owner's Distribution",
    amount: distribution,
  });

  return {
    assets: {
      title: "Assets",
      totalLabel: "Total Assets",
      rows: assetRows,
      total: assetTotal,
    },
    liabilities: {
      title: "Liabilities",
      totalLabel: "Total Liabilities",
      rows: liabilityRows,
      total: liabilityTotal,
    },
    equity: {
      title: "Owner's Equity",
      totalLabel: "Total Owner's Equity",
      rows: equityRows,
      total: equityTotal,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Exact fixed-template balance sheet
 *
 * Renders the precise two-panel layout the COO specified (see
 * "Balance sheet how shuld it look.csv"): every category and clearing
 * line appears with its exact name as a STATIC row, in the exact order,
 * whether or not a matching GL account exists yet. Real balances are
 * plugged in by account code where one exists; every other line reads
 * $0 until that account is added to the chart of accounts.
 *
 * Section totals are the sum of the lines actually shown, so each panel
 * is internally consistent with what's on screen. GL accounts that have
 * no line in this template (see the notes returned) are therefore NOT
 * included — this template is the target structure, not a GL dump.
 * ------------------------------------------------------------------ */

export type ExactBSRow =
  | { kind: "section"; label: string }
  | { kind: "category"; label: string; amount: number | null; codes?: string[] }
  | {
      kind: "line";
      label: string;
      amount: number;
      codes?: string[];
      /** "ownerDistribution" renders an inline editable input (manual figure). */
      role?: "ownerDistribution";
    }
  | {
      kind: "total";
      label: string;
      amount: number;
      codes?: string[];
      /** "equityTotal" is recomputed live from the editable distribution. */
      role?: "equityTotal";
    }
  | { kind: "spacer" };

export type ExactBalanceSheet = {
  left: ExactBSRow[];
  right: ExactBSRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
};

export function buildExactBalanceSheet(
  accounts: readonly BalanceAccountMeta[],
  totalsById: ReadonlyMap<string, number>,
  netIncome: number,
  /** Manually entered Owner's Distribution magnitude (positive = amount taken
   *  out); reduces equity. Entered directly on the sheet, not from the GL. */
  ownerDistribution = 0,
): ExactBalanceSheet {
  // Balance per account code, using the page's display convention
  // (asset → −rawSum, liability/equity → +rawSum). Duplicate codes sum.
  const valByCode = new Map<string, number>();
  for (const a of accounts) {
    const v = displayValue(a, totalsById.get(a.id) ?? 0);
    valByCode.set(a.account_code, (valByCode.get(a.account_code) ?? 0) + v);
  }
  const v = (code: string) => valByCode.get(code) ?? 0;
  const sum = (lines: { amount: number }[]) =>
    lines.reduce((s, l) => s + l.amount, 0);

  // ---- Assets ----
  const cashLines = [
    { kind: "line" as const, label: "Cash — LP checking", amount: v("1010"), codes: ["1010"] },
    { kind: "line" as const, label: "Cash — KP checking", amount: v("1020"), codes: ["1020"] },
    { kind: "line" as const, label: "Cash — BP checking", amount: v("1030"), codes: ["1030"] },
    { kind: "line" as const, label: "Cash — WBP checking", amount: v("1040"), codes: ["1040"] },
    {
      kind: "line" as const,
      label: "Cash — One Ops checking",
      amount: v("1050"),
      codes: ["1050"],
    },
  ];
  const cashTotal = sum(cashLines);
  const cashCodes = ["1010", "1020", "1030", "1040", "1050"];

  // The GL has a single "Accounts receivable" (1100); it's shown on the
  // Wires/Checks line so the balance isn't dropped. Stripe/PayPal clearing
  // accounts don't exist yet → static $0.
  const arLines = [
    { kind: "line" as const, label: "AR-Stripe Clearing", amount: 0 },
    { kind: "line" as const, label: "AR-Paypal Clearing", amount: 0 },
    {
      kind: "line" as const,
      label: "AR-Wires/Checks Clearing",
      amount: v("1100"),
      codes: ["1100"],
    },
  ];
  const arTotal = sum(arLines);

  const inventory = v("1200");
  const prepaid = v("1300");
  const totalAssets = cashTotal + arTotal + inventory + prepaid;

  const left: ExactBSRow[] = [
    { kind: "section", label: "Assets" },
    { kind: "category", label: "Cash", amount: cashTotal, codes: cashCodes },
    ...cashLines,
    { kind: "category", label: "Account Receivable", amount: arTotal, codes: ["1100"] },
    ...arLines,
    { kind: "category", label: "Account Receivable - I/C", amount: null },
    { kind: "category", label: "Inventory", amount: inventory, codes: ["1200"] },
    { kind: "category", label: "Prepaid expenses", amount: prepaid, codes: ["1300"] },
    {
      kind: "total",
      label: "Total Assets",
      amount: totalAssets,
      codes: [...cashCodes, "1100", "1200", "1300"],
    },
  ];

  // ---- Liabilities ----
  const cogsLines = [
    { kind: "line" as const, label: "AP COGS Clearing", amount: v("2010"), codes: ["2010"] },
    { kind: "line" as const, label: "AP-Shipping Clearing", amount: 0 },
    { kind: "line" as const, label: "AP-Tariff Clearing", amount: 0 },
  ];
  const cogsTotal = sum(cogsLines);

  const marketingLines = [
    { kind: "line" as const, label: "AP-Google Ads Clearing", amount: 0 },
    { kind: "line" as const, label: "AP-Meta Ads Clearing", amount: 0 },
    { kind: "line" as const, label: "AP-Bing Ads Clearing", amount: 0 },
    { kind: "line" as const, label: "AP-ASI Clearing", amount: 0 },
  ];
  const marketingTotal = sum(marketingLines);

  const salariesLines = [
    { kind: "line" as const, label: "AP Salaries Clearing", amount: v("2100"), codes: ["2100"] },
    { kind: "line" as const, label: "Tax Withholding - Clearing", amount: 0 },
    { kind: "line" as const, label: "AP-Medicare & SS Clearing", amount: 0 },
    { kind: "line" as const, label: "AP-SUTA & FUTA Clearing", amount: 0 },
  ];
  const salariesTotal = sum(salariesLines);

  const othersLines = [
    {
      kind: "line" as const,
      label: "Credit card payable — LP",
      amount: v("2400"),
      codes: ["2400"],
    },
    {
      kind: "line" as const,
      label: "Credit card payable — KP",
      amount: v("2410"),
      codes: ["2410"],
    },
    {
      kind: "line" as const,
      label: "Credit card payable — BP",
      amount: v("2420"),
      codes: ["2420"],
    },
  ];
  const othersTotal = sum(othersLines);

  const salesTax = 0; // no GL account yet
  const apIC = v("2300"); // Intercompany payable

  const totalLiabilities =
    cogsTotal +
    marketingTotal +
    salariesTotal +
    othersTotal +
    salesTax +
    apIC;
  const liabilityCodes = ["2010", "2100", "2400", "2410", "2420", "2300"];

  // ---- Owner's Equity ----
  // Three peer line items (Retained Earnings, Net Income, Owner's Distribution)
  // under the section header — none is a sub-header. Net Income comes from the
  // P&L (passed in). Owner's Distribution is entered manually on the sheet
  // (positive magnitude), reduces equity, and is no longer read from GL
  // accounts 3030/3100.
  const retained = v("3020");
  const distributionImpact = -ownerDistribution;
  const totalEquity = retained + netIncome + distributionImpact;

  const right: ExactBSRow[] = [
    { kind: "section", label: "Liabilities" },
    { kind: "category", label: "Accounts Payable - COGS", amount: cogsTotal, codes: ["2010"] },
    ...cogsLines,
    {
      kind: "category",
      label: "Accounts Payable - Marketing",
      amount: marketingTotal,
    },
    ...marketingLines,
    {
      kind: "category",
      label: "Accounts Payable - Salaries",
      amount: salariesTotal,
      codes: ["2100"],
    },
    ...salariesLines,
    {
      kind: "category",
      label: "Accounts Payable - Others",
      amount: othersTotal,
      codes: ["2400", "2410", "2420"],
    },
    ...othersLines,
    { kind: "category", label: "Accounts Payable - Sales Tax", amount: salesTax },
    { kind: "category", label: "Accounts Payable - I/C", amount: apIC, codes: ["2300"] },
    { kind: "spacer" },
    {
      kind: "total",
      label: "Total Liabilities",
      amount: totalLiabilities,
      codes: liabilityCodes,
    },
    { kind: "spacer" },
    { kind: "section", label: "Owner's Equity" },
    { kind: "line", label: "Retained Earnings", amount: retained, codes: ["3020"] },
    { kind: "line", label: "Net Income", amount: netIncome },
    {
      kind: "line",
      label: "Owner's Distribution",
      amount: distributionImpact,
      role: "ownerDistribution",
    },
    { kind: "spacer" },
    {
      kind: "total",
      label: "Total Owner's Equity",
      amount: totalEquity,
      codes: ["3020"],
      role: "equityTotal",
    },
  ];

  return { left, right, totalAssets, totalLiabilities, totalEquity };
}
