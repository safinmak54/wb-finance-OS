/**
 * Classification-rule categories.
 *
 * Each rule carries one of these four buckets, picked explicitly on the
 * Rules admin screen. They mirror the statement a rule's tagged
 * transactions land in (Balance Sheet vs P&L) but do NOT drive placement —
 * posting still flows from the linked account.
 */

import type { Account } from "@/lib/supabase/types";

export const RULE_CATEGORIES = [
  { value: "bs_asset", label: "Balance Sheet – Asset" },
  { value: "bs_liability", label: "Balance Sheet – Liability" },
  { value: "pnl_revenue", label: "P&L – Revenue" },
  { value: "pnl_expense", label: "P&L – Expense" },
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number]["value"];

export const RULE_CATEGORY_LABEL: Record<RuleCategory, string> =
  Object.fromEntries(
    RULE_CATEGORIES.map((c) => [c.value, c.label]),
  ) as Record<RuleCategory, string>;

export const RULE_CATEGORY_VALUES = RULE_CATEGORIES.map(
  (c) => c.value,
) as readonly RuleCategory[];

/**
 * Best-effort mapping from an account's type to a rule category, used to
 * prefill the picker when an account is chosen. Equity has no bucket, so it
 * returns null (the admin must pick manually).
 */
export function categoryForAccountType(
  type: Account["account_type"],
): RuleCategory | null {
  switch (type) {
    case "asset":
      return "bs_asset";
    case "liability":
      return "bs_liability";
    case "revenue":
      return "pnl_revenue";
    case "expense":
      return "pnl_expense";
    default:
      return null;
  }
}
