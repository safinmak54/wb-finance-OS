"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";
import { normalizeDate } from "@/lib/format";
import { detectEntityFromBankAccount } from "@/lib/entities";

const TXN_ROLES = ["bookkeeper", "admin"] as const;

/**
 * Chart-of-accounts code for the credit-card settlement suspense account
 * (migration 0019). CC settlements ("payments") are parked here — a
 * balance-sheet liability line — instead of being silently dropped, until
 * finance decides their final posting destination. See
 * plan/credit-card-settlements-separation.md.
 */
const CC_SETTLEMENT_SUSPENSE_CODE = "2999";
/** Memo stamped on parked settlement rows so the bucket is filterable and the
 *  eventual reclass journal entry can target it. */
const CC_SETTLEMENT_MEMO = "cc_settlement:unposted";

const ClassifyOneSchema = z.object({
  rawId: z.string().uuid(),
  accountId: z.string().uuid(),
  entityCode: z.string().trim().min(1).max(40),
});

/**
 * Mark one raw_transactions row as classified, posting a corresponding
 * `transactions` row to the ledger. Mirrors `app.classifySingleRow()`
 * from legacy/app.js (~line 4342).
 */
export async function classifyTransaction(
  input: z.input<typeof ClassifyOneSchema>,
) {
  const me = await requireRole(TXN_ROLES);
  const parsed = ClassifyOneSchema.parse(input);

  const supabase = createDataClient();

  const { data: raw, error: loadErr } = await supabase
    .from("raw_transactions")
    .select("*")
    .eq("id", parsed.rawId)
    .single();
  if (loadErr || !raw) throw new Error("Transaction not found");

  // Closed-period check
  const accDate = raw.accounting_date ?? raw.transaction_date;
  const period = String(accDate).slice(0, 7);
  const { data: closed } = await supabase
    .from("closed_periods")
    .select("id")
    .eq("period", period)
    .eq("entity", parsed.entityCode)
    .maybeSingle();
  if (closed) throw new Error(`Period ${period} is closed`);

  const signedAmount =
    raw.direction === "DEBIT"
      ? -Math.abs(Number(raw.amount))
      : Math.abs(Number(raw.amount));

  // Ignore on checksum conflict so re-classifying the same content is a no-op
  // rather than creating a duplicate `transactions` row (migration 0016).
  const { error: insErr } = await supabase.from("transactions").upsert(
    {
      raw_transaction_id: parsed.rawId,
      entity: parsed.entityCode,
      account_id: parsed.accountId,
      amount: signedAmount,
      txn_date: normalizeDate(raw.transaction_date),
      acc_date: normalizeDate(raw.accounting_date ?? raw.transaction_date),
      description: raw.description ?? "",
      memo: "",
    },
    { onConflict: "checksum", ignoreDuplicates: true },
  );
  if (insErr) throw new Error(insErr.message);

  const { error: upErr } = await supabase
    .from("raw_transactions")
    .update({ classified: true, classified_at: new Date().toISOString() })
    .eq("id", parsed.rawId);
  if (upErr) throw new Error(upErr.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    rowId: parsed.rawId,
    op: "UPDATE",
    after: { classified: true, accountId: parsed.accountId },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
  revalidatePath("/ledger");
}

const UnfinalizeSchema = z.object({
  rawId: z.string().uuid(),
});

/**
 * Revert a finalized (classified) raw row back to the inbox — the inverse of
 * {@link classifyTransaction} / {@link markAsInternalTransfer} /
 * {@link markAsCcPayment}. Deletes the posted `transactions` row(s) for this
 * raw id (transfer / CC-payment rows have none, so that's a no-op), then
 * clears `classified` / `classified_at` and resets `status` to "review" so the
 * row reappears in the "To classify" tab, fully editable again.
 *
 * Closed-period gated like classification: a finalized row in a closed period
 * can't be silently reopened.
 */
export async function unfinalizeTransaction(
  input: z.input<typeof UnfinalizeSchema>,
) {
  const me = await requireRole(TXN_ROLES);
  const parsed = UnfinalizeSchema.parse(input);

  const supabase = createDataClient();

  const { data: raw, error: loadErr } = await supabase
    .from("raw_transactions")
    .select("*")
    .eq("id", parsed.rawId)
    .single();
  if (loadErr || !raw) throw new Error("Transaction not found");
  if (!raw.classified) throw new Error("Transaction is not finalized");

  // Posted ledger row(s) for this raw id — present for normally-classified
  // rows, absent for those marked as internal transfer / CC payment.
  const { data: posted, error: postedErr } = await supabase
    .from("transactions")
    .select("id, entity")
    .eq("raw_transaction_id", parsed.rawId);
  if (postedErr) throw new Error(postedErr.message);

  // Resolve the entity code for the closed-period check: prefer the posted
  // row's entity, fall back to mapping raw.entity_id through `entities`.
  let entityCode: string | null = posted?.[0]?.entity ?? null;
  if (!entityCode && raw.entity_id) {
    const { data: ent } = await supabase
      .from("entities")
      .select("code")
      .eq("id", raw.entity_id)
      .maybeSingle();
    entityCode = ent?.code ?? null;
  }

  const accDate = raw.accounting_date ?? raw.transaction_date;
  const period = String(accDate).slice(0, 7);
  if (entityCode) {
    const { data: closed } = await supabase
      .from("closed_periods")
      .select("id")
      .eq("period", period)
      .eq("entity", entityCode)
      .maybeSingle();
    if (closed) throw new Error(`Period ${period} is closed`);
  }

  if (posted && posted.length > 0) {
    const { error: delErr } = await supabase
      .from("transactions")
      .delete()
      .eq("raw_transaction_id", parsed.rawId);
    if (delErr) throw new Error(delErr.message);
  }

  const { error: upErr } = await supabase
    .from("raw_transactions")
    .update({ classified: false, classified_at: null, status: "review" })
    .eq("id", parsed.rawId);
  if (upErr) throw new Error(upErr.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    rowId: parsed.rawId,
    op: "UPDATE",
    before: { classified: true },
    after: { classified: false, unpostedLedgerRows: posted?.length ?? 0 },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
  revalidatePath("/ledger");
  revalidatePath("/journals");
}

const BulkClassifySchema = z.object({
  rows: z
    .array(
      z.object({
        rawId: z.string().uuid(),
        accountId: z.string().uuid(),
        entityCode: z.string().trim().min(1).max(40),
      }),
    )
    .min(1)
    .max(500),
});

export async function bulkClassifyTransactions(
  input: z.input<typeof BulkClassifySchema>,
) {
  const me = await requireRole(TXN_ROLES);
  const parsed = BulkClassifySchema.parse(input);

  const supabase = createDataClient();

  // Batched, not per-row: doing this one `classifyTransaction` at a time meant
  // ~5 serial Supabase round-trips per row (load → closed-check → upsert →
  // update → audit) plus repeated requireRole / revalidatePath. At a few
  // hundred rows that's thousands of serial round-trips — minutes of wall time
  // and enough load to time the origin out (522). Here it's a fixed handful of
  // queries regardless of batch size.
  const ids = parsed.rows.map((r) => r.rawId);
  const { data: raws, error: loadErr } = await supabase
    .from("raw_transactions")
    .select("*")
    .in("id", ids);
  if (loadErr) throw new Error(loadErr.message);
  const rawById = new Map((raws ?? []).map((r) => [r.id, r] as const));

  // Closed-period gate (mirrors classifyTransaction): reject the whole batch if
  // any row would post into a closed (period, entity). One query for all pairs.
  const pairs = parsed.rows
    .map((row) => {
      const raw = rawById.get(row.rawId);
      if (!raw) return null;
      const accDate = raw.accounting_date ?? raw.transaction_date;
      return { period: String(accDate).slice(0, 7), entity: row.entityCode };
    })
    .filter((p): p is { period: string; entity: string } => p !== null);

  if (pairs.length > 0) {
    const { data: closed } = await supabase
      .from("closed_periods")
      .select("period, entity")
      .in("period", [...new Set(pairs.map((p) => p.period))])
      .in("entity", [...new Set(pairs.map((p) => p.entity))]);
    const closedSet = new Set(
      (closed ?? [])
        .filter((c) => c.entity)
        .map((c) => `${c.period}|${c.entity}`),
    );
    const hit = pairs.find((p) => closedSet.has(`${p.period}|${p.entity}`));
    if (hit) throw new Error(`Period ${hit.period} is closed for ${hit.entity}`);
  }

  // Build every ledger insert and post them in a single upsert. Ignore on
  // checksum conflict so re-finalizing identical content is a no-op (0016).
  const inserts = parsed.rows
    .map((row) => {
      const raw = rawById.get(row.rawId);
      if (!raw) return null;
      const signedAmount =
        raw.direction === "DEBIT"
          ? -Math.abs(Number(raw.amount))
          : Math.abs(Number(raw.amount));
      return {
        raw_transaction_id: row.rawId,
        entity: row.entityCode,
        account_id: row.accountId,
        amount: signedAmount,
        txn_date: normalizeDate(raw.transaction_date),
        acc_date: normalizeDate(raw.accounting_date ?? raw.transaction_date),
        description: raw.description ?? "",
        memo: "",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (inserts.length === 0) return;

  const { error: insErr } = await supabase
    .from("transactions")
    .upsert(inserts, { onConflict: "checksum", ignoreDuplicates: true });
  if (insErr) throw new Error(insErr.message);

  const postedIds = inserts.map((i) => i.raw_transaction_id);
  const { error: upErr } = await supabase
    .from("raw_transactions")
    .update({ classified: true, classified_at: new Date().toISOString() })
    .in("id", postedIds);
  if (upErr) throw new Error(upErr.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    op: "UPDATE",
    after: { bulk: postedIds.length },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
  revalidatePath("/ledger");
}

const SplitSchema = z.object({
  rawId: z.string().uuid(),
  splits: z
    .array(
      z.object({
        amount: z.number().positive(),
        accounting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .min(2)
    .max(20),
});

/**
 * Split a single raw_transactions row across multiple accounting dates.
 * Replaces the original row with N children, preserving the parent
 * external_id but appending `-1`, `-2`, …. Mirrors `openSplitModal` →
 * `submitSplit` from legacy/app.js (~line 4582).
 */
export async function splitTransaction(input: z.input<typeof SplitSchema>) {
  const me = await requireRole(TXN_ROLES);
  const parsed = SplitSchema.parse(input);

  const supabase = createDataClient();
  const { data: parent, error } = await supabase
    .from("raw_transactions")
    .select("*")
    .eq("id", parsed.rawId)
    .single();
  if (error || !parent) throw new Error("Source transaction not found");

  const totalSplit = parsed.splits.reduce((s, x) => s + x.amount, 0);
  if (Math.abs(totalSplit - Number(parent.amount)) > 0.01) {
    throw new Error("Split totals must equal the original amount");
  }

  const inserts = parsed.splits.map((s) => ({
    entity_id: parent.entity_id,
    source: parent.source,
    bank_connection_id: parent.bank_connection_id,
    transaction_date: parent.transaction_date,
    accounting_date: s.accounting_date,
    amount: s.amount,
    direction: parent.direction,
    description: parent.description,
    status: parent.status,
    classified: false,
  }));

  const { error: insErr } = await supabase
    .from("raw_transactions")
    .insert(inserts);
  if (insErr) throw new Error(insErr.message);

  const { error: delErr } = await supabase
    .from("raw_transactions")
    .delete()
    .eq("id", parsed.rawId);
  if (delErr) throw new Error(delErr.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    rowId: parsed.rawId,
    op: "UPDATE",
    after: { splitInto: parsed.splits.length },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
}

const MarkKindSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/** Mark rows as internal bank transfers. Doesn't post to the ledger
 *  (transfers between own accounts don't hit the P&L) — just removes
 *  them from the inbox by flipping `classified` and `status`. */
export async function markAsInternalTransfer(
  input: z.input<typeof MarkKindSchema>,
) {
  const me = await requireRole(TXN_ROLES);
  const parsed = MarkKindSchema.parse(input);

  const supabase = createDataClient();
  const { error } = await supabase
    .from("raw_transactions")
    .update({
      classified: true,
      classified_at: new Date().toISOString(),
      status: "confirmed",
    })
    .in("id", parsed.ids);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    op: "UPDATE",
    after: { markedAs: "transfer", count: parsed.ids.length },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
}

/**
 * Mark rows as credit-card payments / settlements (bank → CC). A settlement
 * pays down the card balance — a balance-sheet event, NOT a P&L expense (the
 * expense was already booked when the card was charged). Per finance
 * (2026-06-30) these must be *separated* from real expenses; the final
 * posting destination is still TBD, so each row is parked in the
 * Credit Card Settlements suspense account (migration 0019) rather than
 * dropped. Unlike a true internal transfer it DOES post a `transactions`
 * row — so the parked total is visible, summable, and re-postable later.
 * See plan/credit-card-settlements-separation.md.
 */
export async function markAsCcPayment(
  input: z.input<typeof MarkKindSchema>,
) {
  const me = await requireRole(TXN_ROLES);
  const parsed = MarkKindSchema.parse(input);

  const supabase = createDataClient();

  // Load the raw rows so we can post a settlement row per id.
  const { data: rows, error: loadErr } = await supabase
    .from("raw_transactions")
    .select(
      "id, entity_id, bank_account, description, amount, direction, transaction_date, accounting_date",
    )
    .in("id", parsed.ids);
  if (loadErr) throw new Error(loadErr.message);

  // Resolve the suspense account (must exist — migration 0019).
  const { data: acct, error: acctErr } = await supabase
    .from("accounts")
    .select("id")
    .eq("account_code", CC_SETTLEMENT_SUSPENSE_CODE)
    .maybeSingle();
  if (acctErr) throw new Error(acctErr.message);
  if (!acct) {
    throw new Error(
      `CC settlement suspense account ${CC_SETTLEMENT_SUSPENSE_CODE} is missing — apply migration 0019`,
    );
  }

  // entity_id → entity code, to stamp each posted row's entity (NOT NULL).
  const idToCode: Record<string, string> = {};
  const { data: ents } = await supabase.from("entities").select("id, code");
  for (const e of ents ?? []) idToCode[e.id] = e.code;

  // A settlement must not be posted into a locked period. Find which
  // (period, entity) pairs among these rows are closed, and skip posting a
  // GL row for those (they're still flipped to classified, as before).
  const resolveEntity = (r: (typeof rows)[number]): string =>
    (r.entity_id ? idToCode[r.entity_id] : undefined) ??
    detectEntityFromBankAccount(r.bank_account ?? r.description) ??
    "WB";
  const periodFor = (r: (typeof rows)[number]): string =>
    String(r.accounting_date ?? r.transaction_date).slice(0, 7);

  const candidates = (rows ?? []).map((r) => ({
    raw: r,
    entity: resolveEntity(r),
    period: periodFor(r),
  }));

  const periods = [...new Set(candidates.map((c) => c.period))];
  const entities = [...new Set(candidates.map((c) => c.entity))];
  const closedSet = new Set<string>();
  if (periods.length && entities.length) {
    const { data: closed } = await supabase
      .from("closed_periods")
      .select("period, entity")
      .in("period", periods)
      .in("entity", entities);
    for (const c of closed ?? []) closedSet.add(`${c.period}__${c.entity}`);
  }

  const postable = candidates.filter(
    (c) => !closedSet.has(`${c.period}__${c.entity}`),
  );
  const skippedClosed = candidates.length - postable.length;

  if (postable.length) {
    const settlementRows = postable.map(({ raw, entity }) => ({
      raw_transaction_id: raw.id,
      entity,
      account_id: acct.id,
      amount:
        raw.direction === "DEBIT"
          ? -Math.abs(Number(raw.amount))
          : Math.abs(Number(raw.amount)),
      txn_date: normalizeDate(raw.transaction_date),
      acc_date: normalizeDate(raw.accounting_date ?? raw.transaction_date),
      description: raw.description ?? "",
      memo: CC_SETTLEMENT_MEMO,
    }));
    // Ignore on checksum conflict so re-marking the same content is a no-op
    // (mirrors classifyTransaction; migration 0016).
    const { error: insErr } = await supabase
      .from("transactions")
      .upsert(settlementRows, {
        onConflict: "checksum",
        ignoreDuplicates: true,
      });
    if (insErr) throw new Error(insErr.message);
  }

  const { error } = await supabase
    .from("raw_transactions")
    .update({
      classified: true,
      classified_at: new Date().toISOString(),
      status: "confirmed",
    })
    .in("id", parsed.ids);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    op: "UPDATE",
    after: {
      markedAs: "cc_payment",
      count: parsed.ids.length,
      posted: postable.length,
      skippedClosed,
      suspenseAccount: CC_SETTLEMENT_SUSPENSE_CODE,
    },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
  revalidatePath("/ledger");
  revalidatePath("/balance");
}

export async function deleteRawTransaction(id: string) {
  const me = await requireRole(TXN_ROLES);
  const supabase = createDataClient();

  const { data: existing, error: loadErr } = await supabase
    .from("raw_transactions")
    .select("source")
    .eq("id", id)
    .single();
  if (loadErr || !existing) throw new Error("Transaction not found");
  if (existing.source !== "manual") {
    throw new Error(
      "Cannot delete bank-imported transactions — use Untag in Ledger instead.",
    );
  }

  const { error } = await supabase
    .from("raw_transactions")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    rowId: id,
    op: "DELETE",
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
}

const EditRawDateSchema = z.object({
  id: z.string().uuid(),
  accountingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Change the *accounting* date of a raw (pre-classification) bank row
 * without touching the immutable bank `transaction_date`. Used to accrue
 * a transaction into a different period than it cleared the bank — e.g.
 * wages that cleared in March but belong to February.
 *
 * Reversible by design: pass `accountingDate` equal to the row's
 * `transaction_date` to clear the override. The UI flags any row where
 * `accounting_date !== transaction_date` so the change stays visible.
 */
export async function editRawTransactionDate(
  input: z.input<typeof EditRawDateSchema>,
) {
  const me = await requireRole(TXN_ROLES);
  const parsed = EditRawDateSchema.parse(input);

  const supabase = createDataClient();
  const { data: raw, error: loadErr } = await supabase
    .from("raw_transactions")
    .select("transaction_date, accounting_date")
    .eq("id", parsed.id)
    .single();
  if (loadErr || !raw) throw new Error("Transaction not found");

  const { error } = await supabase
    .from("raw_transactions")
    .update({ accounting_date: parsed.accountingDate })
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    rowId: parsed.id,
    op: "UPDATE",
    before: { accounting_date: raw.accounting_date },
    after: { accounting_date: parsed.accountingDate },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
  revalidatePath("/cashbook-inbox");
}

const EditTxnSchema = z.object({
  id: z.string().uuid(),
  amount: z.number().optional(),
  description: z.string().trim().max(400).optional(),
  acc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  account_id: z.string().uuid().optional(),
});

/** Edit a posted transaction row (book side). */
export async function editTransaction(input: z.input<typeof EditTxnSchema>) {
  const me = await requireRole(TXN_ROLES);
  const parsed = EditTxnSchema.parse(input);
  const { id, ...fields } = parsed;

  const supabase = createDataClient();
  const { error } = await supabase
    .from("transactions")
    .update(fields)
    .eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "transactions",
    rowId: id,
    op: "UPDATE",
    after: fields,
  });

  revalidatePath("/ledger");
  revalidatePath("/journals");
}
