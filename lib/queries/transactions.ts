import type { Sb } from "./_client";
import type {
  Account,
  RawTransaction,
  Transaction,
} from "@/lib/supabase/types";
import { applyEntityIdFilter, applyEntityCodeFilter } from "@/lib/entity-filter";
import type { EntityFilterValue } from "@/lib/entities";

export type RawTxnRow = RawTransaction;

export type LedgerRow = Transaction & {
  accounts: Pick<
    Account,
    "id" | "account_code" | "account_name" | "account_type"
  > | null;
};

const CC_SOURCES = "(credit_card,amex,capital_one)";
const CAPONE_DESC_LIKE = "%CAPITAL ONE ONLINE%";

/** Bank-side inbox: unclassified bank statement rows. Excludes CC sources
 *  AND Capital One Online description matches (mirrors legacy renderInbox). */
export async function listUnclassifiedBank(
  supabase: Sb,
  opts: { entity?: EntityFilterValue; codeToId?: Record<string, string> } = {},
): Promise<RawTxnRow[]> {
  let q = supabase
    .from("raw_transactions")
    .select("*")
    .eq("classified", false)
    .order("accounting_date", { ascending: false });

  if (opts.entity && opts.codeToId) {
    q = applyEntityIdFilter(q, "entity_id", opts.entity, opts.codeToId);
  }

  q = q
    .not("source", "in", CC_SOURCES)
    .not("description", "ilike", CAPONE_DESC_LIKE);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** CC-side inbox: unclassified credit-card rows. Mirrors legacy renderCCInbox
 *  which uses `or(source.in.(…), description.ilike.%CAPITAL ONE ONLINE%)`
 *  so untagged Capital One Online rows still surface here. */
export async function listUnclassifiedCC(
  supabase: Sb,
  opts: { entity?: EntityFilterValue; codeToId?: Record<string, string> } = {},
): Promise<RawTxnRow[]> {
  let q = supabase
    .from("raw_transactions")
    .select("*")
    .eq("classified", false)
    .order("accounting_date", { ascending: false });

  if (opts.entity && opts.codeToId) {
    q = applyEntityIdFilter(q, "entity_id", opts.entity, opts.codeToId);
  }

  q = q.or(
    `source.in.${CC_SOURCES},description.ilike.${CAPONE_DESC_LIKE}`,
  );

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Posted ledger view: classified transactions with their account joined. */
export async function listLedgerView(
  supabase: Sb,
  opts: {
    entity?: EntityFilterValue;
    range?: { from: string; to: string };
  } = {},
): Promise<LedgerRow[]> {
  let q = supabase
    .from("transactions")
    .select(
      "*, accounts(id, account_code, account_name, account_type)",
    )
    .order("acc_date", { ascending: false });

  if (opts.range) {
    q = q.gte("acc_date", opts.range.from).lte("acc_date", opts.range.to);
  }
  if (opts.entity && opts.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", opts.entity);
  }

  const { data, error } = await q.returns<LedgerRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function inboxCounts(supabase: Sb): Promise<{
  bank: number;
  cc: number;
}> {
  const [bank, cc] = await Promise.all([
    supabase
      .from("raw_transactions")
      .select("id", { count: "exact", head: true })
      .eq("classified", false)
      .not("source", "in", CC_SOURCES)
      .not("description", "ilike", CAPONE_DESC_LIKE),
    supabase
      .from("raw_transactions")
      .select("id", { count: "exact", head: true })
      .eq("classified", false)
      .or(`source.in.${CC_SOURCES},description.ilike.${CAPONE_DESC_LIKE}`),
  ]);
  return {
    bank: bank.count ?? 0,
    cc: cc.count ?? 0,
  };
}

export type DrillDownTxn = {
  id: string;
  acc_date: string;
  description: string | null;
  entity: string;
  amount: number;
  account_id: string | null;
  memo: string | null;
  raw_transaction_id: string | null;
};

/** P&L drill-down: transactions for a single account in a period.
 *  Mirrors `app.drillDown()` from legacy/app.js (~line 3726). */
export async function listTxnsForAccount(
  supabase: Sb,
  args: {
    accountId: string;
    range: { from: string; to: string };
    entity?: EntityFilterValue;
  },
): Promise<DrillDownTxn[]> {
  let q = supabase
    .from("transactions")
    .select(
      "id, acc_date, description, entity, amount, account_id, memo, raw_transaction_id",
    )
    .eq("account_id", args.accountId)
    .gte("acc_date", args.range.from)
    .lte("acc_date", args.range.to)
    .order("acc_date", { ascending: false });

  if (args.entity && args.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", args.entity);
  }

  const { data, error } = await q.returns<DrillDownTxn[]>();
  if (error) throw error;
  return data ?? [];
}
