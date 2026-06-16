import type { Account } from "@/lib/supabase/types";
import type { AccountAggregate } from "@/lib/queries/reports";

/**
 * Shared P&L account structure. Extracted from app/(app)/pnl/page.tsx so the
 * Dashboard's month-wise summary computes the exact same numbers as the P&L
 * report and can never drift from it.
 */

export type Subtype =
  | "gross_revenue"
  | "sales_return"
  | "platform_fee"
  | "cogs"
  | "sales_tax"
  | "marketing"
  | "labour"
  | "opex"
  | "distribution";

// 4070 (Gross Revenue – RP) and 5005 (COGS – RP) are intentionally hidden
// from the P&L view per business decision.
//
// 6020 Meta Ads, 6040 Bing Ads, 6050 ASI Ads, 6150 Platform Fee - Stripe,
// and 6155 Platform Fee - Paypal are also hidden per business decision: they
// previously fell through to the Operating Expenses (opex) fallback. Hiding
// them removes their spend from the report entirely, so Net Profit / Balance
// rise by their total — they are NOT reclassified to another section.
export const HIDDEN_ACCOUNT_CODES: ReadonlySet<string> = new Set([
  "4070",
  "5005",
  "6020",
  "6040",
  "6050",
  "6150",
  "6155",
]);

// Account-code → P&L subtype mapping. This is intentionally a hardcoded list
// rather than derived from `accounts.account_subtype`: that column is
// inconsistent (mixes generic types like "expense"/"revenue"/"current" with
// P&L subtypes, uses "payroll" for labour, splits ads across
// "marketing"/"advertising", and even tags the asset 5020 Shipping-Clearing
// as "cogs"). Deriving from it dropped whole sections (Labour, Sales Tax,
// Sales Return) and polluted COGS with an asset, producing wrong totals.
export const CODE_TO_SUBTYPE: Record<string, Subtype> = (() => {
  const map: Record<string, Subtype> = {};
  for (const c of ["4040", "4050", "4060", "4070", "4080"]) {
    map[c] = "gross_revenue";
  }
  for (const c of ["4045", "4055", "4065", "4900"]) {
    map[c] = "sales_return";
  }
  for (const c of ["4075", "4076"]) {
    map[c] = "platform_fee";
  }
  for (const c of ["5000", "5005"]) {
    map[c] = "cogs";
  }
  for (const c of ["5040"]) {
    map[c] = "sales_tax";
  }
  // 6010/6025/6028 are the per-channel ad *clearing* accounts (bank cash
  // parked before it's reclassified to 6000/6001/6002). They hold real
  // spend and are distinct from the synthesized ad accounts, so they belong
  // in Marketing too — surfacing them avoids hiding money stuck in clearing.
  for (const c of [
    "6000",
    "6001",
    "6002",
    "6003",
    "6004",
    "6005",
    "6010",
    "6025",
    "6028",
    "6030",
  ]) {
    map[c] = "marketing";
  }
  // 6101 Wages - Clearing and 6115 Upwork sit alongside the other labour
  // accounts; without them, wages parked in the clearing account never show.
  for (const c of ["6100", "6101", "6110", "6112", "6115", "6120", "6121"]) {
    map[c] = "labour";
  }
  for (const c of [
    "6200",
    "6300",
    "6400",
    "6450",
    "6500",
    "6510",
    "6600",
    "6610",
    "6615",
    "6620",
    "6640",
    "6645",
    "6646",
    "6648",
  ]) {
    map[c] = "opex";
  }
  for (const c of ["3100"]) {
    map[c] = "distribution";
  }
  return map;
})();

/**
 * Resolve an account to a P&L section. The explicit `CODE_TO_SUBTYPE` map
 * wins (it places known accounts in the right section and handles clearing
 * accounts typed as assets). Anything not in the map falls back to its
 * `account_type` so a revenue or expense account is NEVER silently dropped
 * from the P&L — a new GL account shows up under its natural section the
 * moment it has activity, with no code change needed.
 *
 * Returns null only for balance-sheet accounts (asset / liability / equity)
 * that aren't explicitly mapped — those legitimately don't belong on the P&L.
 * If a balance-sheet account ever needs to appear (e.g. a new clearing
 * account), add it to `CODE_TO_SUBTYPE` above.
 */
export function subtypeFor(a: Account): Subtype | null {
  const explicit = CODE_TO_SUBTYPE[a.account_code];
  if (explicit) return explicit;
  if (a.account_type === "revenue") return "gross_revenue";
  if (a.account_type === "expense") return "opex";
  return null;
}

export function signFor(a: Account): 1 | -1 {
  // Sales Return accounts are revenue-type but debit-normal — stored amounts
  // are negative. Flip so the section shows a positive figure, letting
  // `totalRevenue = revenue − salesReturn − platformFee` work.
  const subtype = CODE_TO_SUBTYPE[a.account_code];
  if (subtype === "sales_return") return -1;
  // Expense-like sections are debit-normal (amounts stored negative, shown
  // positive). Drive the sign off the P&L subtype, not account_type, so
  // clearing accounts typed as "asset" (6010 Ads-Clearing, 6101
  // Wages-Clearing) still book into their expense section with the correct
  // sign instead of falling through to +1 and inflating Net Profit.
  if (
    subtype === "cogs" ||
    subtype === "sales_tax" ||
    subtype === "marketing" ||
    subtype === "labour" ||
    subtype === "opex"
  ) {
    return -1;
  }
  if (a.account_type === "revenue") return 1;
  if (a.account_type === "expense") return -1;
  if (a.account_type === "equity") return -1;
  return 1;
}

export type MonthlyPnlMetrics = {
  grossRevenue: number;
  cogs: number;
  adSpends: number;
  adminExp: number;
  netIncome: number;
};

function emptyMetrics(): MonthlyPnlMetrics {
  return { grossRevenue: 0, cogs: 0, adSpends: 0, adminExp: 0, netIncome: 0 };
}

/**
 * Per-month headline P&L metrics for the Dashboard summary. Sums each subtype
 * across all (already entity-filtered) accounts using `AccountAggregate.byMonth`
 * (entity-agnostic; manual entries are expected to be merged in already).
 *
 * Definitions match the P&L report (app/(app)/pnl/page.tsx):
 *   grossRevenue = gross_revenue section (the % denominator)
 *   cogs         = cogs + sales_tax  (the P&L "Cost of Goods Sold" group)
 *   adSpends     = marketing
 *   adminExp     = labour + opex
 *   netIncome    = (grossRevenue − sales_return − platform_fee)
 *                   − cogs − sales_tax − marketing − labour − opex
 *                  i.e. the P&L Net Profit row, excluding Distribution.
 */
export function computeMonthlyPnl(
  aggregates: Map<string, AccountAggregate>,
  accounts: readonly Account[],
  monthKeys: readonly string[],
): Map<string, MonthlyPnlMetrics> {
  const out = new Map<string, MonthlyPnlMetrics>();
  for (const key of monthKeys) out.set(key, emptyMetrics());

  const accountsById = new Map<string, Account>();
  for (const a of accounts) accountsById.set(a.id, a);

  for (const [accountId, agg] of aggregates) {
    const account = accountsById.get(accountId);
    if (!account) continue;
    if (HIDDEN_ACCOUNT_CODES.has(account.account_code)) continue;
    const subtype = subtypeFor(account);
    if (!subtype) continue;
    const sign = signFor(account);

    for (const key of monthKeys) {
      const value = (agg.byMonth.get(key) ?? 0) * sign;
      if (value === 0) continue;
      const m = out.get(key)!;
      switch (subtype) {
        case "gross_revenue":
          m.grossRevenue += value;
          m.netIncome += value;
          break;
        case "sales_return":
        case "platform_fee":
          m.netIncome -= value;
          break;
        case "cogs":
          m.cogs += value;
          m.netIncome -= value;
          break;
        case "sales_tax":
          m.cogs += value;
          m.netIncome -= value;
          break;
        case "marketing":
          m.adSpends += value;
          m.netIncome -= value;
          break;
        case "labour":
        case "opex":
          m.adminExp += value;
          m.netIncome -= value;
          break;
        case "distribution":
          // Excluded from Net Income (matches P&L "Net Profit", not "Balance").
          break;
      }
    }
  }
  return out;
}
