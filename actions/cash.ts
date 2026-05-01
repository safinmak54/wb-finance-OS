"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const CASH_ROLES = ["coo", "bookkeeper", "cpa", "admin"] as const;

const SaveCashBalanceSchema = z.object({
  entity: z.string().trim().min(1).max(40),
  col_key: z.string().trim().min(1).max(40),
  value: z.number().nullable(),
});

export async function saveCashBalance(
  input: z.input<typeof SaveCashBalanceSchema>,
) {
  const me = await requireRole(CASH_ROLES);
  const parsed = SaveCashBalanceSchema.parse(input);

  const supabase = createDataClient();

  if (parsed.value === null || parsed.value === 0) {
    const { error } = await supabase
      .from("cash_balances")
      .delete()
      .eq("entity", parsed.entity)
      .eq("col_key", parsed.col_key);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      actorUserId: me.userId,
      table: "cash_balances",
      op: "DELETE",
      before: parsed,
    });
  } else {
    const { error } = await supabase
      .from("cash_balances")
      .upsert(
        {
          entity: parsed.entity,
          col_key: parsed.col_key,
          value: parsed.value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "entity,col_key" },
      );
    if (error) throw new Error(error.message);
    await writeAuditLog({
      actorUserId: me.userId,
      table: "cash_balances",
      op: "UPDATE",
      after: parsed,
    });
  }

  revalidatePath("/cash-balances");
}
