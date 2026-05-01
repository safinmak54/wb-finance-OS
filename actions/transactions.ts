"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";
import { normalizeDate } from "@/lib/format";

const TXN_ROLES = ["bookkeeper", "admin"] as const;

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

  const { error: insErr } = await supabase.from("transactions").insert({
    raw_transaction_id: parsed.rawId,
    entity: parsed.entityCode,
    account_id: parsed.accountId,
    amount: signedAmount,
    txn_date: normalizeDate(raw.transaction_date),
    acc_date: normalizeDate(raw.accounting_date ?? raw.transaction_date),
    description: raw.description ?? "",
    memo: "",
  });
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

  // Run sequentially so we get clear error semantics; volume here is
  // bounded by the schema (max 500 rows).
  for (const row of parsed.rows) {
    await classifyTransaction(row);
  }

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    op: "UPDATE",
    after: { bulk: parsed.rows.length },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
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

  const inserts = parsed.splits.map((s, i) => ({
    entity_id: parent.entity_id,
    source: parent.source,
    external_id: parent.external_id
      ? `${parent.external_id}-${i + 1}`
      : null,
    transaction_date: parent.transaction_date,
    accounting_date: s.accounting_date,
    amount: s.amount,
    direction: parent.direction,
    description: parent.description,
    vendor: parent.vendor,
    txn_type: parent.txn_type,
    category: parent.category,
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

export async function deleteRawTransaction(id: string) {
  const me = await requireRole(TXN_ROLES);
  const supabase = createDataClient();
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
