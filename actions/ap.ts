"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const AP_ROLES = ["coo", "cpa", "admin"] as const;

const PaySchema = z.object({ id: z.string().uuid() });
const DisputeSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().min(1).max(500),
});

/** Mark an `ap_items` row as paid. */
export async function payApItem(input: z.input<typeof PaySchema>) {
  const me = await requireRole(AP_ROLES);
  const { id } = PaySchema.parse(input);

  const supabase = createDataClient();
  const { error } = await supabase
    .from("ap_items")
    .update({ status: "paid" })
    .eq("id", id);
  if (error) throw error;

  await writeAuditLog({
    actorUserId: me.userId,
    table: "ap_items",
    rowId: id,
    op: "UPDATE",
    after: { status: "paid" },
  });

  revalidatePath("/ap");
}

// Dispute is disabled: ap_items has no dispute_note column in the current
// schema. Re-enable once the column is added.
export async function disputeApItem(input: z.input<typeof DisputeSchema>) {
  await requireRole(AP_ROLES);
  DisputeSchema.parse(input);
  throw new Error(
    "Dispute is unavailable: ap_items.dispute_note column does not exist.",
  );
}
