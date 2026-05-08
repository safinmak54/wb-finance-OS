"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";
import { applyEntityIdFilter, applyEntityCodeFilter } from "@/lib/entity-filter";
import { entityCodeToId } from "@/lib/queries/entities";
import type { EntityFilterValue } from "@/lib/entities";

const RECON_ROLES = ["coo", "bookkeeper", "admin"] as const;

const MatchSchema = z.object({
  statement_txn_id: z.string().uuid(),
  book_txn_id: z.string().uuid(),
  amount: z.number(),
  match_status: z.enum(["matched", "disputed", "manual"]).default("matched"),
});

export async function markMatched(input: z.input<typeof MatchSchema>) {
  const me = await requireRole(RECON_ROLES);
  const parsed = MatchSchema.parse(input);

  const supabase = createDataClient();
  const { error } = await supabase
    .from("reconciliation_matches")
    .upsert(parsed, { onConflict: "statement_txn_id" });
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "reconciliation_matches",
    op: "INSERT",
    after: parsed,
  });

  revalidatePath("/reconcile");
}

const AutoMatchSchema = z.object({
  entity: z.string().trim().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Auto-match unreconciled bank rows to posted ledger entries by
 * amount (±$0.01) and accounting date (±3 days). Mirrors
 * `app.autoMatch()` from legacy/app.js (~line 3272).
 *
 * - 1 candidate → upsert match_status='matched'
 * - 2+ candidates → upsert match_status='pending' (book_txn_id null)
 *   so the user can resolve ambiguity manually.
 */
export async function autoMatchPeriod(
  input: z.input<typeof AutoMatchSchema>,
): Promise<{ matched: number; pending: number }> {
  const me = await requireRole(RECON_ROLES);
  const parsed = AutoMatchSchema.parse(input);
  const supabase = createDataClient();
  const entityValue = parsed.entity as EntityFilterValue;

  const codeToId = await entityCodeToId(supabase);

  let bankQ = supabase
    .from("raw_transactions")
    .select("id, accounting_date, transaction_date, description, amount, direction, entity_id")
    .gte("accounting_date", parsed.from)
    .lte("accounting_date", parsed.to);
  bankQ = applyEntityIdFilter(bankQ, "entity_id", entityValue, codeToId);

  let bookQ = supabase
    .from("transactions")
    .select("id, acc_date, description, amount, entity")
    .gte("acc_date", parsed.from)
    .lte("acc_date", parsed.to);
  bookQ = applyEntityCodeFilter(bookQ, "entity", entityValue);

  const [bankRes, bookRes] = await Promise.all([bankQ, bookQ]);
  if (bankRes.error) throw new Error(bankRes.error.message);
  if (bookRes.error) throw new Error(bookRes.error.message);

  const bankRows = bankRes.data ?? [];
  const bookRows = bookRes.data ?? [];

  const used = new Set<string>();
  type Insert = {
    statement_txn_id: string;
    book_txn_id: string | null;
    amount: number;
    match_status: string;
    matched_at?: string;
  };
  const inserts: Insert[] = [];

  for (const bank of bankRows) {
    const bankAmt =
      bank.direction === "DEBIT"
        ? -Math.abs(Number(bank.amount))
        : Math.abs(Number(bank.amount));
    const bankDate = new Date(bank.accounting_date ?? bank.transaction_date).getTime();

    const candidates = bookRows.filter((book) => {
      if (used.has(book.id)) return false;
      const bookDate = new Date(book.acc_date).getTime();
      const days = Math.abs(bankDate - bookDate) / 86_400_000;
      return Math.abs(Number(book.amount) - bankAmt) < 0.01 && days <= 3;
    });

    if (candidates.length === 1) {
      used.add(candidates[0].id);
      inserts.push({
        statement_txn_id: bank.id,
        book_txn_id: candidates[0].id,
        amount: bankAmt,
        match_status: "matched",
        matched_at: new Date().toISOString(),
      });
    } else if (candidates.length > 1) {
      inserts.push({
        statement_txn_id: bank.id,
        book_txn_id: null,
        amount: bankAmt,
        match_status: "pending",
      });
    }
  }

  if (inserts.length) {
    const { error } = await supabase
      .from("reconciliation_matches")
      // Supabase column allows null book_txn_id for pending rows.
      .upsert(inserts as never, { onConflict: "statement_txn_id" });
    if (error) throw new Error(error.message);
  }

  const matched = inserts.filter((i) => i.match_status === "matched").length;
  const pending = inserts.length - matched;

  await writeAuditLog({
    actorUserId: me.userId,
    table: "reconciliation_matches",
    op: "INSERT",
    after: { auto: true, matched, pending, range: { from: parsed.from, to: parsed.to }, entity: parsed.entity },
  });

  revalidatePath("/reconcile");
  return { matched, pending };
}

export async function unmatch(statementTxnId: string) {
  const me = await requireRole(RECON_ROLES);
  const supabase = createDataClient();
  const { error } = await supabase
    .from("reconciliation_matches")
    .delete()
    .eq("statement_txn_id", statementTxnId);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "reconciliation_matches",
    op: "DELETE",
    before: { statement_txn_id: statementTxnId },
  });
  revalidatePath("/reconcile");
}
