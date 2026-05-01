import type { Sb } from "./_client";
import type { Account } from "@/lib/supabase/types";
import { applyEntityCodeFilter } from "@/lib/entity-filter";
import type { EntityFilterValue } from "@/lib/entities";

export type ReportTxn = {
  amount: number;
  account_id: string | null;
  memo: string | null;
  accounts: Pick<
    Account,
    "id" | "account_code" | "account_name" | "account_type" | "account_subtype"
  > | null;
};

export type ReportData = {
  txns: ReportTxn[];
  range: { from: string; to: string };
  entity: EntityFilterValue;
};

/**
 * Mirrors `app.fetchReportData()` from legacy/app.js (~line 723). Pulls the
 * `transactions` rows for the period+entity, with their `accounts`
 * relation eagerly joined.
 */
export async function fetchReportData(
  supabase: Sb,
  args: { entity: EntityFilterValue; from: string; to: string },
): Promise<ReportData> {
  let q = supabase
    .from("transactions")
    .select(
      "amount, account_id, memo, accounts(id, account_code, account_name, account_type, account_subtype)",
    )
    .gte("acc_date", args.from)
    .lte("acc_date", args.to);

  if (args.entity && args.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", args.entity);
  }

  const { data, error } = await q.returns<ReportTxn[]>();
  if (error) throw error;

  return {
    txns: data ?? [],
    range: { from: args.from, to: args.to },
    entity: args.entity,
  };
}

/** Group transactions by account_id, summing amounts. */
export function groupByAccount(
  txns: readonly ReportTxn[],
): Array<{ account: ReportTxn["accounts"]; total: number }> {
  const groups = new Map<string, { account: ReportTxn["accounts"]; total: number }>();
  for (const t of txns) {
    if (!t.accounts || !t.account_id) continue;
    const existing = groups.get(t.account_id);
    if (existing) {
      existing.total += Number(t.amount ?? 0);
    } else {
      groups.set(t.account_id, {
        account: t.accounts,
        total: Number(t.amount ?? 0),
      });
    }
  }
  return [...groups.values()];
}

/** Roll up by P&L `line` (subtotal label from accounts.line). */
export function groupByLine(
  txns: readonly ReportTxn[],
  accountTypeFilter?: Account["account_type"][],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of txns) {
    if (!t.accounts) continue;
    if (
      accountTypeFilter &&
      !accountTypeFilter.includes(t.accounts.account_type)
    ) {
      continue;
    }
    const line = t.accounts.account_name; // accounts.line not in select; fallback to name
    out.set(line, (out.get(line) ?? 0) + Number(t.amount ?? 0));
  }
  return out;
}

export type Totals = {
  revenue: number;
  cogs: number;
  expense: number;
  asset: number;
  liability: number;
  equity: number;
};

/** Sum amounts by account_type. amount is signed: negative=debit. */
export function totals(txns: readonly ReportTxn[]): Totals {
  const out: Totals = {
    revenue: 0,
    cogs: 0,
    expense: 0,
    asset: 0,
    liability: 0,
    equity: 0,
  };
  for (const t of txns) {
    if (!t.accounts) continue;
    const amt = Number(t.amount ?? 0);
    const type = t.accounts.account_type;
    const subtype = t.accounts.account_subtype;
    if (type === "revenue") out.revenue += amt;
    else if (type === "expense" && subtype === "cogs") out.cogs += -amt;
    else if (type === "expense") out.expense += -amt;
    else if (type === "asset") out.asset += -amt;
    else if (type === "liability") out.liability += amt;
    else if (type === "equity") out.equity += amt;
  }
  return out;
}
