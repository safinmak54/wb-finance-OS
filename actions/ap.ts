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

/** Mark an `ap_items` row as paid. Mirrors legacy `app.payApItem()`
 *  (legacy/app.js:7158): just sets `paid=true`. */
export async function payApItem(input: z.input<typeof PaySchema>) {
  const me = await requireRole(AP_ROLES);
  const { id } = PaySchema.parse(input);

  const supabase = createDataClient();
  const { error } = await supabase
    .from("ap_items")
    .update({ paid: true })
    .eq("id", id);
  if (error) throw error;

  await writeAuditLog({
    actorUserId: me.userId,
    table: "ap_items",
    rowId: id,
    op: "UPDATE",
    after: { paid: true },
  });

  revalidatePath("/ap");
}

/** Attach a dispute note to an `ap_items` row. Mirrors legacy
 *  `app.disputeApItem()` (legacy/app.js:7167). */
export async function disputeApItem(input: z.input<typeof DisputeSchema>) {
  const me = await requireRole(AP_ROLES);
  const parsed = DisputeSchema.parse(input);

  const supabase = createDataClient();
  const { error } = await supabase
    .from("ap_items")
    .update({ dispute_note: parsed.note })
    .eq("id", parsed.id);
  if (error) throw error;

  await writeAuditLog({
    actorUserId: me.userId,
    table: "ap_items",
    rowId: parsed.id,
    op: "UPDATE",
    after: { dispute_note: parsed.note },
  });

  revalidatePath("/ap");
}
