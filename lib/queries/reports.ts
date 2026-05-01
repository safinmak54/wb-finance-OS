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

export type ReportJournalLine = {
  debit_amount: number;
  credit_amount: number;
  memo: string | null;
  account_id: string | null;
  accounts: Pick<
    Account,
    "account_code" | "account_name" | "account_type" | "account_subtype"
  > | null;
};

export type ReportJournal = {
  id: string;
  accounting_date: string;
  description: string;
  entry_type: string;
  period: string | null;
  entity_id: string | null;
  ledger_entries: ReportJournalLine[];
};

export type ReportData = {
  txns: ReportTxn[];
  journals: ReportJournal[];
  range: { from: string; to: string };
  entity: EntityFilterValue;
};

/** Balance sheet rows include the elimination flag so consolidation can
 *  drop intercompany lines. Mirrors `app.fetchBalanceSheetData` from
 *  legacy/app.js (~line 1360). */
export type BalanceSheetTxn = {
  amount: number;
  account_id: string | null;
  accounts: Pick<
    Account,
    | "id"
    | "account_code"
    | "account_name"
    | "account_type"
    | "account_subtype"
    | "is_elimination"
  > | null;
};

/**
 * Mirrors `app.fetchReportData()` from legacy/app.js (~line 723). Pulls the
 * `transactions` rows for the period+entity, with their `accounts`
 * relation eagerly joined, AND the period's `journal_entries` (with
 * `ledger_entries` and accounts) so callers can apply adjusting/accrual
 * deltas (legacy reads both into the P&L).
 */
export async function fetchReportData(
  supabase: Sb,
  args: { entity: EntityFilterValue; from: string; to: string },
): Promise<ReportData> {
  let txnQ = supabase
    .from("transactions")
    .select(
      "amount, account_id, memo, accounts(id, account_code, account_name, account_type, account_subtype)",
    )
    .gte("acc_date", args.from)
    .lte("acc_date", args.to);

  if (args.entity && args.entity !== "all") {
    txnQ = applyEntityCodeFilter(txnQ, "entity", args.entity);
  }

  let jeQ = supabase
    .from("journal_entries")
    .select(
      "id, accounting_date, description, entry_type, period, entity_id, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name, account_type, account_subtype))",
    )
    .gte("period", args.from.slice(0, 7))
    .lte("period", args.to.slice(0, 7));

  if (args.entity && args.entity !== "all") {
    jeQ = applyEntityCodeFilter(jeQ, "entity", args.entity);
  }

  const [txnRes, jeRes] = await Promise.all([
    txnQ.returns<ReportTxn[]>(),
    jeQ.returns<ReportJournal[]>(),
  ]);
  if (txnRes.error) throw txnRes.error;

  return {
    txns: txnRes.data ?? [],
    journals: jeRes.error ? [] : (jeRes.data ?? []),
    range: { from: args.from, to: args.to },
    entity: args.entity,
  };
}

/**
 * Mirrors `app.fetchBalanceSheetData()` from legacy/app.js (~line 1360).
 * No date filter — balance sheet uses cumulative balances across all
 * history. Includes `is_elimination` so intercompany lines can be dropped.
 */
export async function fetchBalanceSheetData(
  supabase: Sb,
  args: { entity: EntityFilterValue },
): Promise<BalanceSheetTxn[]> {
  let q = supabase
    .from("transactions")
    .select(
      "amount, account_id, accounts(id, account_code, account_name, account_type, account_subtype, is_elimination)",
    );

  if (args.entity && args.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", args.entity);
  }

  const { data, error } = await q.returns<BalanceSheetTxn[]>();
  if (error) throw error;
  return data ?? [];
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

/** Group balance-sheet transactions by account_id (same shape, includes
 *  the elimination flag in account). */
export function groupBalanceByAccount(
  txns: readonly BalanceSheetTxn[],
): Array<{ account: BalanceSheetTxn["accounts"]; total: number }> {
  const groups = new Map<
    string,
    { account: BalanceSheetTxn["accounts"]; total: number }
  >();
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

/**
 * Adjusting/accrual journal-entry deltas to fold into P&L.
 * Mirrors the loop in legacy/app.js around `_renderPnlSummary` and the AI
 * context builder (~line 6940): for each adjusting JE line, credit−debit
 * goes to revenue, and debit−credit (i.e. the negative of that) goes to
 * cogs/expense, broken down by account_type/subtype.
 */
export function pnlAdjustment(
  journals: readonly ReportJournal[],
  opts: { entryTypes?: readonly string[] } = {},
): { revenue: number; cogs: number; expense: number } {
  const allowed = new Set(opts.entryTypes ?? ["adjusting", "accrual"]);
  const out = { revenue: 0, cogs: 0, expense: 0 };
  for (const je of journals) {
    if (!allowed.has(je.entry_type)) continue;
    for (const le of je.ledger_entries ?? []) {
      const acct = le.accounts;
      if (!acct) continue;
      const debit = Number(le.debit_amount ?? 0);
      const credit = Number(le.credit_amount ?? 0);
      if (acct.account_type === "revenue") {
        out.revenue += credit - debit;
      } else if (acct.account_type === "expense") {
        if (acct.account_subtype === "cogs") out.cogs += debit - credit;
        else out.expense += debit - credit;
      }
    }
  }
  return out;
}
