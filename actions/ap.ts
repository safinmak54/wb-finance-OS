"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const AP_ROLES = ["coo", "cpa", "admin"] as const;

const PaySchema = z.object({ id: z.string().uuid() });

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
