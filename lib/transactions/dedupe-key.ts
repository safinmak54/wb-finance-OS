/**
 * In-array dedupe key for `transactions` rows, mirroring the DB-side
 * generated `checksum` column (migrations 0016 + 0017 + 0018). Used to drop
 * duplicate rows from a multi-row insert payload BEFORE it hits the DB, since
 * a single `insert ... on conflict do nothing` statement can still collide
 * on two sibling rows that share the same checksum.
 *
 * The DB checksum remains the source of truth for cross-statement dedup;
 * this only guards within a single batch. Keep the field list and the
 * branching in sync with the generated column.
 *
 * Branching mirrors migration 0018: admin-API sync rows (`source` like
 * `admin_api:%`) hash content only — every sync re-mints raw_transaction_id,
 * so folding it in would make each re-sync look distinct and create
 * duplicates. All other rows include raw_transaction_id + memo (0017) so
 * genuinely-distinct look-alike charges stay distinct.
 */
export function txnDedupeKey(t: {
  entity: string;
  account_id: string | null;
  amount: number;
  description: string | null;
  txn_date: string;
  acc_date: string;
  source?: string | null;
  raw_transaction_id?: string | null;
  memo?: string | null;
}): string {
  const parts = [
    t.entity,
    t.account_id ?? "",
    Math.round(t.amount * 100) / 100,
    t.description ?? "",
    t.txn_date,
    t.acc_date,
    t.source ?? "",
  ];
  if (!(t.source ?? "").startsWith("admin_api:")) {
    parts.push(t.raw_transaction_id ?? "", t.memo ?? "");
  }
  return parts.join("|");
}

/** Drop later rows whose `txnDedupeKey` already appeared earlier in the array. */
export function dedupeByChecksum<T extends Parameters<typeof txnDedupeKey>[0]>(
  rows: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = txnDedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
