import type { Sb } from "./_client";
import type { Account } from "@/lib/supabase/types";
import type { AccountAggregate } from "./reports";

export type PnlManualEntry = {
  id: string;
  account_id: string;
  entity_code: string;
  month: string; // YYYY-MM
  amount: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Account codes the Admin API populates. These are read-only on the
 *  P&L — values come from `transactions` rows synthesized at cashbook
 *  snapshot time, not from manual entry. */
export const API_SOURCED_ACCOUNT_CODES: ReadonlySet<string> = new Set([
  "4040",
  "4050",
  "4060",
  "4045",
  "4055",
  "4065",
  "5000",
  "6000",
  "6001",
  "6002",
  "6003",
]);

export async function listPnlManualEntries(
  supabase: Sb,
  args: { from: string; to: string },
): Promise<PnlManualEntry[]> {
  // Compare YYYY-MM strings lexicographically against the range months.
  const fromMonth = args.from.slice(0, 7);
  const toMonth = args.to.slice(0, 7);
  const { data, error } = await supabase
    .from("pnl_manual_entries")
    .select(
      "id, account_id, entity_code, month, amount, note, created_by, created_at, updated_at",
    )
    .gte("month", fromMonth)
    .lte("month", toMonth);
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") return [];
    throw error;
  }
  return (data ?? []) as PnlManualEntry[];
}

/**
 * Fold manual entries into the same Map<accountId, AccountAggregate> shape
 * the cashbook aggregator produces. Sign convention is identical: amounts
 * are stored "as if they were transactions.amount rows" so the page's
 * signFor() works unchanged.
 *
 * The user enters a positive number; the page applies signFor on render.
 * For revenue-type accounts (4070, 4080) that means we store +amount.
 * For sales_return / expense accounts we store −amount.
 */
export function mergeManualEntriesIntoAggregates(
  aggregates: Map<string, AccountAggregate>,
  entries: readonly PnlManualEntry[],
  accounts: readonly Account[],
  codeToSubtype: Record<string, string>,
): void {
  const accountsById = new Map<string, Account>();
  for (const a of accounts) accountsById.set(a.id, a);

  for (const e of entries) {
    const account = accountsById.get(e.account_id);
    if (!account) continue;
    const subtype = codeToSubtype[account.account_code];
    const raw = signedRaw(Number(e.amount), account, subtype);

    let agg = aggregates.get(account.id);
    if (!agg) {
      agg = {
        account: {
          id: account.id,
          account_code: account.account_code,
          account_name: account.account_name,
          account_type: account.account_type,
          account_subtype: account.account_subtype,
        },
        byEntity: new Map(),
        byMonth: new Map(),
        byEntityMonth: new Map(),
      };
      aggregates.set(account.id, agg);
    }
    agg.byEntity.set(
      e.entity_code,
      (agg.byEntity.get(e.entity_code) ?? 0) + raw,
    );
    agg.byMonth.set(e.month, (agg.byMonth.get(e.month) ?? 0) + raw);
    let monthMap = agg.byEntityMonth.get(e.entity_code);
    if (!monthMap) {
      monthMap = new Map();
      agg.byEntityMonth.set(e.entity_code, monthMap);
    }
    monthMap.set(e.month, (monthMap.get(e.month) ?? 0) + raw);
  }
}

function signedRaw(
  userAmount: number,
  account: Account,
  subtype: string | undefined,
): number {
  // Mirrors signFor() in app/(app)/pnl/page.tsx — invert so that
  // value × signFor(account) on render = the user's input.
  if (subtype === "sales_return") return -userAmount;
  if (account.account_type === "revenue") return userAmount;
  if (account.account_type === "expense") return -userAmount;
  if (account.account_type === "equity") return -userAmount;
  return userAmount;
}
