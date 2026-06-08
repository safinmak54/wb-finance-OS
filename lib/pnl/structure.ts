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
export const HIDDEN_ACCOUNT_CODES: ReadonlySet<string> = new Set([
  "4070",
  "5005",
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
  for (const c of ["6000", "6001", "6002", "6003", "6004", "6030"]) {
    map[c] = "marketing";
  }
  for (const c of ["6100", "6110", "6112", "6120", "6121"]) {
    map[c] = "labour";
  }
  for (const c of [
    "6200",
    "6300",
    "6400",
    "6450",
    "6600",
    "6615",
    "6620",
    "6640",
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

export function signFor(a: Account): 1 | -1 {
  // Sales Return accounts are revenue-type but debit-normal — stored amounts
  // are negative. Flip so the section shows a positive figure, letting
  // `totalRevenue = revenue − salesReturn − platformFee` work.
  const subtype = CODE_TO_SUBTYPE[a.account_code];
  if (subtype === "sales_return") return -1;
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
    const subtype = CODE_TO_SUBTYPE[account.account_code];
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
