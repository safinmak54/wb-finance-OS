"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

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
