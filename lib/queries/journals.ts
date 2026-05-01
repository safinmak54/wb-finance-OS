import type { Sb } from "./_client";
import type {
  Account,
  JournalEntry,
  LedgerEntry,
} from "@/lib/supabase/types";
import { applyEntityCodeFilter } from "@/lib/entity-filter";
import type { EntityFilterValue } from "@/lib/entities";

export type JournalRow = JournalEntry & {
  ledger_entries: Array<
    Pick<LedgerEntry, "debit_amount" | "credit_amount" | "memo" | "account_id"> & {
      accounts: Pick<
        Account,
        "account_code" | "account_name" | "account_type" | "account_subtype"
      > | null;
    }
  >;
};

export async function listJournals(
  supabase: Sb,
  opts: {
    entity?: EntityFilterValue;
    range?: { from: string; to: string };
  } = {},
): Promise<JournalRow[]> {
  let q = supabase
    .from("journal_entries")
    .select(
      "*, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name, account_type, account_subtype))",
    )
    .order("accounting_date", { ascending: false });

  if (opts.range) {
    q = q
      .gte("accounting_date", opts.range.from)
      .lte("accounting_date", opts.range.to);
  }
  if (opts.entity && opts.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", opts.entity);
  }

  const { data, error } = await q.returns<JournalRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function getJournalWithLines(
  supabase: Sb,
  id: string,
): Promise<JournalRow | null> {
  const { data, error } = await supabase
    .from("journal_entries")
    .select(
      "*, ledger_entries(debit_amount, credit_amount, memo, account_id, accounts(account_code, account_name, account_type, account_subtype))",
    )
    .eq("id", id)
    .returns<JournalRow[]>()
    .maybeSingle();
  if (error) throw error;
  return (data as JournalRow | null) ?? null;
}

export async function listClosedPeriods(
  supabase: Sb,
): Promise<Array<{ period: string; entity: string | null; closed_at: string }>> {
  const { data, error } = await supabase
    .from("closed_periods")
    .select("period, entity, closed_at");
  if (error) throw error;
  return data ?? [];
}

export type JeTaggedTxn = {
  id: string;
  acc_date: string;
  description: string | null;
  amount: number;
  memo: string | null;
  account_id: string | null;
  accounts: Pick<Account, "account_code" | "account_name"> | null;
};

/**
 * Fallback for the journals view: transactions tagged with `memo LIKE 'je:%'`.
 * Mirrors legacy/app.js (~line 1563): catches journal-derived postings whose
 * `journal_entries` FK join failed but the offsetting transaction was posted.
 * Caller dedupes by JE id (memo strips the `je:` prefix).
 */
export async function listJeTaggedTransactions(
  supabase: Sb,
  opts: {
    range: { from: string; to: string };
    entity?: EntityFilterValue;
  },
): Promise<JeTaggedTxn[]> {
  let q = supabase
    .from("transactions")
    .select(
      "id, acc_date, description, amount, memo, account_id, accounts(account_code, account_name)",
    )
    .like("memo", "je:%")
    .gte("acc_date", opts.range.from)
    .lte("acc_date", opts.range.to);

  if (opts.entity && opts.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", opts.entity);
  }

  const { data, error } = await q.returns<JeTaggedTxn[]>();
  if (error) throw error;
  return data ?? [];
}
