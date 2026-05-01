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

/** Bank-side inbox: unclassified bank statement rows. Excludes CC sources. */
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

  // Exclude credit-card sources from the bank inbox
  q = q.not("source", "in", "(credit_card,amex,capital_one)");

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** CC-side inbox: unclassified credit-card rows. */
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

  q = q.in("source", ["credit_card", "amex", "capital_one"]);

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
      .not("source", "in", "(credit_card,amex,capital_one)"),
    supabase
      .from("raw_transactions")
      .select("id", { count: "exact", head: true })
      .eq("classified", false)
      .in("source", ["credit_card", "amex", "capital_one"]),
  ]);
  return {
    bank: bank.count ?? 0,
    cc: cc.count ?? 0,
  };
}
