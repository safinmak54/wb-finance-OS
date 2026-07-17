"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const WRITE_ROLES = ["coo", "bookkeeper", "cpa", "admin"] as const;

/**
 * Owner's Distribution is a manually maintained equity figure entered directly
 * on the Balance Sheet (the accountant types it in). It has no double-entry GL
 * posting yet, so we persist it in the existing `cash_balances` key/value store
 * under a reserved `col_key` rather than adding a migration. The cash-balances
 * grid renders from a fixed column list, so this reserved key never surfaces
 * there. Replace with a dedicated table / real GL entry in the double-entry
 * rebuild (see questions.md).
 *
 * `value` is the distribution magnitude (positive = amount taken out); it is
 * subtracted from Owner's Equity on the sheet. Zero clears the stored figure.
 */
const OWNER_DISTRIBUTION_KEY = "owner_distribution";

const SaveOwnerDistributionSchema = z.object({
  entity: z.string().trim().min(1).max(40),
  value: z.number().nonnegative(),
});

export async function saveOwnerDistribution(
  input: z.input<typeof SaveOwnerDistributionSchema>,
) {
  const me = await requireRole(WRITE_ROLES);
  const { entity, value } = SaveOwnerDistributionSchema.parse(input);

  const supabase = createDataClient();

  if (value === 0) {
    const { error } = await supabase
      .from("cash_balances")
      .delete()
      .eq("entity", entity)
      .eq("col_key", OWNER_DISTRIBUTION_KEY);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      actorUserId: me.userId,
      table: "cash_balances",
      op: "DELETE",
      before: { entity, col_key: OWNER_DISTRIBUTION_KEY },
    });
  } else {
    const { error } = await supabase.from("cash_balances").upsert(
      {
        entity,
        col_key: OWNER_DISTRIBUTION_KEY,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity,col_key" },
    );
    if (error) throw new Error(error.message);
    await writeAuditLog({
      actorUserId: me.userId,
      table: "cash_balances",
      op: "UPDATE",
      after: { entity, col_key: OWNER_DISTRIBUTION_KEY, value },
    });
  }

  revalidatePath("/balance");
}
