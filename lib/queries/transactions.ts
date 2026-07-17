import type { Sb } from "./_client";
import type {
  Account,
  RawTransaction,
  Transaction,
} from "@/lib/supabase/types";
import { applyEntityIdFilter, applyEntityCodeFilter } from "@/lib/entity-filter";
import type { EntityFilterValue } from "@/lib/entities";
import { ADMIN_API_RAW_SOURCE } from "@/lib/admin-api/synthesize-transactions";

export type RawTxnRow = RawTransaction;

export type LedgerRow = Transaction & {
  accounts: Pick<
    Account,
    "id" | "account_code" | "account_name" | "account_type"
  > | null;
};

const CC_SOURCES = "(credit_card,amex,capital_one)";
const CAPONE_DESC_LIKE = "%CAPITAL ONE ONLINE%";

/** Which side of the transaction inbox a query targets. */
export type TxnSide = "bank" | "cc";

export type RawListOpts = {
  entity?: EntityFilterValue;
  codeToId?: Record<string, string>;
  /** Optional accounting-date window (inclusive). Used by the month picker. */
  range?: { from: string; to: string };
};

/** Narrow a `raw_transactions` query to one side of the inbox.
 *  - "bank": exclude CC sources, Capital One Online description matches, and
 *    Admin-API rows (which have their own dedicated inbox).
 *  - "cc": credit-card sources OR untagged Capital One Online rows (mirrors
 *    legacy renderCCInbox). */
function applySideFilter<
  Q extends {
    not(column: string, operator: string, value: string): Q;
    neq(column: string, value: string): Q;
    or(filters: string): Q;
  },
>(q: Q, side: TxnSide): Q {
  if (side === "cc") {
    return q.or(`source.in.${CC_SOURCES},description.ilike.${CAPONE_DESC_LIKE}`);
  }
  return q
    .not("source", "in", CC_SOURCES)
    .not("description", "ilike", CAPONE_DESC_LIKE)
    .neq("source", ADMIN_API_RAW_SOURCE);
}

/** Core lister for the bank/CC inbox: raw rows for one side, either pending
 *  (`classified=false`) or finalized (`classified=true`), optionally windowed
 *  by accounting date. Pending rows order by accounting date (oldest work
 *  surfaces predictably); finalized rows order by when they were finalized. */
async function listRawBySide(
  supabase: Sb,
  side: TxnSide,
  classified: boolean,
  opts: RawListOpts,
): Promise<RawTxnRow[]> {
  let q = supabase
    .from("raw_transactions")
    .select("*")
    .eq("classified", classified)
    .order(classified ? "classified_at" : "accounting_date", {
      ascending: false,
    });

  if (opts.entity && opts.codeToId) {
    q = applyEntityIdFilter(q, "entity_id", opts.entity, opts.codeToId);
  }

  q = applySideFilter(q, side);

  if (opts.range) {
    q = q
      .gte("accounting_date", opts.range.from)
      .lte("accounting_date", opts.range.to);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Bank-side inbox: unclassified bank statement rows. Excludes CC sources
 *  AND Capital One Online description matches (mirrors legacy renderInbox),
 *  and Admin-API-sourced rows, which have their own dedicated inbox
 *  (see {@link listUnclassifiedAdminApi}). */
export function listUnclassifiedBank(
  supabase: Sb,
  opts: RawListOpts = {},
): Promise<RawTxnRow[]> {
  return listRawBySide(supabase, "bank", false, opts);
}

/** Bank-side finalized rows (classified=true) for the read-only Finalized tab. */
export function listClassifiedBank(
  supabase: Sb,
  opts: RawListOpts = {},
): Promise<RawTxnRow[]> {
  return listRawBySide(supabase, "bank", true, opts);
}

/** CC-side finalized rows (classified=true) for the read-only Finalized tab. */
export function listClassifiedCC(
  supabase: Sb,
  opts: RawListOpts = {},
): Promise<RawTxnRow[]> {
  return listRawBySide(supabase, "cc", true, opts);
}

/** Admin-API inbox: unclassified rows synthesized from the Admin API
 *  cashbook sync (source = "admin_api"). These are kept out of the bank
 *  inbox so the two streams classify independently. Normally the cashbook
 *  fetch action auto-classifies these immediately, so anything still
 *  sitting here is genuinely pending. */
export async function listUnclassifiedAdminApi(
  supabase: Sb,
  opts: { entity?: EntityFilterValue; codeToId?: Record<string, string> } = {},
): Promise<RawTxnRow[]> {
  let q = supabase
    .from("raw_transactions")
    .select("*")
    .eq("classified", false)
    .eq("source", ADMIN_API_RAW_SOURCE)
    .order("accounting_date", { ascending: false });

  if (opts.entity && opts.codeToId) {
    q = applyEntityIdFilter(q, "entity_id", opts.entity, opts.codeToId);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** CC-side inbox: unclassified credit-card rows. Mirrors legacy renderCCInbox
 *  which uses `or(source.in.(…), description.ilike.%CAPITAL ONE ONLINE%)`
 *  so untagged Capital One Online rows still surface here. */
export function listUnclassifiedCC(
  supabase: Sb,
  opts: RawListOpts = {},
): Promise<RawTxnRow[]> {
  return listRawBySide(supabase, "cc", false, opts);
}

/** Count of still-pending rows for one side (ignores any date window) — drives
 *  the "To classify (N)" tab label so it stays accurate while viewing the
 *  Finalized tab or a narrowed month. */
export async function countUnclassifiedSide(
  supabase: Sb,
  side: TxnSide,
  opts: { entity?: EntityFilterValue; codeToId?: Record<string, string> } = {},
): Promise<number> {
  let q = supabase
    .from("raw_transactions")
    .select("id", { count: "exact", head: true })
    .eq("classified", false);

  if (opts.entity && opts.codeToId) {
    q = applyEntityIdFilter(q, "entity_id", opts.entity, opts.codeToId);
  }
  q = applySideFilter(q, side);

  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Account + entity a finalized raw row was posted to, keyed by
 *  `raw_transaction_id`. Rows marked as internal transfer / CC payment post no
 *  ledger row, so they simply won't appear in this map. */
export type PostedMeta = {
  entity: string;
  account_code: string | null;
  account_name: string | null;
};

export async function postedMetaForRawIds(
  supabase: Sb,
  rawIds: string[],
): Promise<Record<string, PostedMeta>> {
  if (rawIds.length === 0) return {};
  type PostedJoinRow = {
    raw_transaction_id: string | null;
    entity: string;
    accounts: { account_code: string; account_name: string } | null;
  };
  const { data, error } = await supabase
    .from("transactions")
    .select("raw_transaction_id, entity, accounts(account_code, account_name)")
    .in("raw_transaction_id", rawIds)
    .returns<PostedJoinRow[]>();
  if (error) throw error;

  const map: Record<string, PostedMeta> = {};
  for (const t of data ?? []) {
    if (!t.raw_transaction_id) continue;
    map[t.raw_transaction_id] = {
      entity: t.entity,
      account_code: t.accounts?.account_code ?? null,
      account_name: t.accounts?.account_name ?? null,
    };
  }
  return map;
}

/** Posted ledger view: classified transactions with their account joined.
 *  Reads from `transactions_pnl` so Admin-API-sourced rows from prior
 *  snapshot fetches don't double-show after a re-fetch. */
export async function listLedgerView(
  supabase: Sb,
  opts: {
    entity?: EntityFilterValue;
    range?: { from: string; to: string };
  } = {},
): Promise<LedgerRow[]> {
  let q = supabase
    .from("transactions_pnl")
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
  adminApi: number;
}> {
  const [bank, cc, adminApi] = await Promise.all([
    supabase
      .from("raw_transactions")
      .select("id", { count: "exact", head: true })
      .eq("classified", false)
      .not("source", "in", CC_SOURCES)
      .not("description", "ilike", CAPONE_DESC_LIKE)
      .neq("source", ADMIN_API_RAW_SOURCE),
    supabase
      .from("raw_transactions")
      .select("id", { count: "exact", head: true })
      .eq("classified", false)
      .or(`source.in.${CC_SOURCES},description.ilike.${CAPONE_DESC_LIKE}`),
    supabase
      .from("raw_transactions")
      .select("id", { count: "exact", head: true })
      .eq("classified", false)
      .eq("source", ADMIN_API_RAW_SOURCE),
  ]);
  return {
    bank: bank.count ?? 0,
    cc: cc.count ?? 0,
    adminApi: adminApi.count ?? 0,
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
    .from("transactions_pnl")
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

/** P&L drill-down for a set of accounts (section totals, computed lines).
 *  Same shape as listTxnsForAccount but accepts multiple account IDs and an
 *  explicit list of entity codes to restrict to (for entity-column drills). */
export async function listTxnsForAccountSet(
  supabase: Sb,
  args: {
    accountIds: string[];
    range: { from: string; to: string };
    entityCodes?: readonly string[];
  },
): Promise<DrillDownTxn[]> {
  if (args.accountIds.length === 0) return [];
  let q = supabase
    .from("transactions_pnl")
    .select(
      "id, acc_date, description, entity, amount, account_id, memo, raw_transaction_id",
    )
    .in("account_id", args.accountIds)
    .gte("acc_date", args.range.from)
    .lte("acc_date", args.range.to)
    .order("acc_date", { ascending: false });

  if (args.entityCodes && args.entityCodes.length > 0) {
    q = q.in("entity", args.entityCodes as string[]);
  }

  const { data, error } = await q.returns<DrillDownTxn[]>();
  if (error) throw error;
  return data ?? [];
}

/** Balance-sheet drill-down: every transaction backing a set of balance
 *  accounts. Reads the raw `transactions` table with no date bound and only
 *  an entity filter — exactly matching `fetchBalanceSheetData`'s scope — so
 *  the listed rows sum to the balance-sheet line they were opened from. */
export async function listBalanceTxnsForAccountSet(
  supabase: Sb,
  args: {
    accountIds: string[];
    entity?: EntityFilterValue;
  },
): Promise<DrillDownTxn[]> {
  if (args.accountIds.length === 0) return [];
  let q = supabase
    .from("transactions")
    .select(
      "id, acc_date, description, entity, amount, account_id, memo, raw_transaction_id",
    )
    .in("account_id", args.accountIds)
    .order("acc_date", { ascending: false });

  if (args.entity && args.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", args.entity);
  }

  const { data, error } = await q.returns<DrillDownTxn[]>();
  if (error) throw error;
  return data ?? [];
}
