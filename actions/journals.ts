"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const WRITE_ROLES = ["coo", "bookkeeper", "admin"] as const;

const JournalLineSchema = z.object({
  account_id: z.string().uuid(),
  debit_amount: z.number().nonnegative().default(0),
  credit_amount: z.number().nonnegative().default(0),
  memo: z.string().trim().max(200).optional(),
});

const CreateJournalSchema = z.object({
  accounting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(400),
  entity: z.string().trim().min(1).max(40),
  entry_type: z
    .enum(["journal", "manual", "accrual", "elimination", "distribution"])
    .default("manual"),
  status: z.enum(["draft", "POSTED"]).default("POSTED"),
  is_intercompany: z.boolean().default(false),
  lines: z.array(JournalLineSchema).min(2).max(40),
});

function assertBalanced(
  lines: ReadonlyArray<z.infer<typeof JournalLineSchema>>,
) {
  const dr = lines.reduce((s, l) => s + l.debit_amount, 0);
  const cr = lines.reduce((s, l) => s + l.credit_amount, 0);
  if (Math.abs(dr - cr) > 0.01) {
    throw new Error(
      `Journal is unbalanced: debits ${dr.toFixed(2)} ≠ credits ${cr.toFixed(2)}`,
    );
  }
  if (dr === 0) throw new Error("Journal has no amounts");
}

export async function createJournal(
  input: z.input<typeof CreateJournalSchema>,
) {
  const me = await requireRole(WRITE_ROLES);
  const parsed = CreateJournalSchema.parse(input);
  assertBalanced(parsed.lines);

  const supabase = createDataClient();

  // Resolve entity_id (text code → uuid). Tolerate WB-ALL by leaving null.
  const { data: ent } = await supabase
    .from("entities")
    .select("id")
    .eq("code", parsed.entity)
    .maybeSingle();

  const period = parsed.accounting_date.slice(0, 7);

  const { data: je, error: jeErr } = await supabase
    .from("journal_entries")
    .insert({
      accounting_date: parsed.accounting_date,
      description: parsed.description,
      entity: parsed.entity,
      entity_id: ent?.id ?? null,
      entry_type: parsed.entry_type,
      period,
      status: parsed.status,
      is_intercompany: parsed.is_intercompany,
      source: "MANUAL",
    })
    .select("id")
    .single();
  if (jeErr || !je) throw new Error(jeErr?.message ?? "Insert failed");

  const lines = parsed.lines.map((l) => ({
    journal_entry_id: je.id,
    account_id: l.account_id,
    debit_amount: l.debit_amount,
    credit_amount: l.credit_amount,
    memo: l.memo ?? parsed.description,
    entity: parsed.entity,
    entity_id: ent?.id ?? null,
  }));
  const { error: leErr } = await supabase.from("ledger_entries").insert(lines);
  if (leErr) throw new Error(leErr.message);

  // Mirror to `transactions` so P&L picks it up. One row per line, signed.
  if (parsed.status === "POSTED") {
    const txns = parsed.lines.map((l) => ({
      entity: parsed.entity,
      account_id: l.account_id,
      amount: l.credit_amount > 0 ? l.credit_amount : -l.debit_amount,
      txn_date: parsed.accounting_date,
      acc_date: parsed.accounting_date,
      description: parsed.description,
      memo: `je:${je.id}`,
    }));
    await supabase.from("transactions").insert(txns);
  }

  await writeAuditLog({
    actorUserId: me.userId,
    table: "journal_entries",
    rowId: je.id,
    op: "INSERT",
    after: parsed,
  });

  revalidatePath("/journals");
  revalidatePath("/ledger");
  revalidatePath("/pnl");
  revalidatePath("/balance");
  revalidatePath("/cashflow");
  return { id: je.id };
}

export async function deleteJournal(id: string) {
  const me = await requireRole(WRITE_ROLES);
  const supabase = createDataClient();

  // Remove the mirrored book-side transactions first
  await supabase.from("transactions").delete().eq("memo", `je:${id}`);
  // Remove the ledger lines
  await supabase.from("ledger_entries").delete().eq("journal_entry_id", id);
  // Remove the JE itself
  const { error } = await supabase.from("journal_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "journal_entries",
    rowId: id,
    op: "DELETE",
  });

  revalidatePath("/journals");
  revalidatePath("/ledger");
  revalidatePath("/pnl");
  revalidatePath("/balance");
  revalidatePath("/cashflow");
}

const CloseMonthSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  entity: z.string().trim().max(40).optional(),
});

export async function closeMonth(input: z.input<typeof CloseMonthSchema>) {
  const me = await requireRole(WRITE_ROLES);
  const parsed = CloseMonthSchema.parse(input);

  const supabase = createDataClient();
  const { error } = await supabase.from("closed_periods").insert({
    period: parsed.period,
    entity: parsed.entity ?? null,
    closed_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "closed_periods",
    op: "INSERT",
    after: parsed,
  });

  revalidatePath("/journals");
}

export async function reopenMonth(input: z.input<typeof CloseMonthSchema>) {
  const me = await requireRole(WRITE_ROLES);
  const parsed = CloseMonthSchema.parse(input);

  const supabase = createDataClient();
  let q = supabase.from("closed_periods").delete().eq("period", parsed.period);
  if (parsed.entity) q = q.eq("entity", parsed.entity);
  const { error } = await q;
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "closed_periods",
    op: "DELETE",
    before: parsed,
  });

  revalidatePath("/journals");
}
