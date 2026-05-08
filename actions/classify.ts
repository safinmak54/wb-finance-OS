"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const RULE_ROLES = ["admin"] as const;

const UpsertSchema = z.object({
  id: z.string().uuid().optional(),
  pattern: z.string().trim().min(1).max(200),
  account_id: z.string().uuid(),
  vendor_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().default(true),
});

export async function upsertClassificationRule(
  input: z.input<typeof UpsertSchema>,
) {
  const me = await requireRole(RULE_ROLES);
  const parsed = UpsertSchema.parse(input);
  const supabase = createDataClient();

  const payload = {
    pattern: parsed.pattern,
    account_id: parsed.account_id,
    vendor_id: parsed.vendor_id ?? null,
    is_active: parsed.is_active,
  };

  if (parsed.id) {
    const { error } = await supabase
      .from("classification_rules")
      .update(payload)
      .eq("id", parsed.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      actorUserId: me.userId,
      table: "classification_rules",
      rowId: parsed.id,
      op: "UPDATE",
      after: payload,
    });
  } else {
    const { error } = await supabase
      .from("classification_rules")
      .insert(payload);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      actorUserId: me.userId,
      table: "classification_rules",
      op: "INSERT",
      after: payload,
    });
  }

  revalidatePath("/admin/rules");
  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
}

export async function deleteClassificationRule(id: string) {
  const me = await requireRole(RULE_ROLES);
  const supabase = createDataClient();

  const { error } = await supabase
    .from("classification_rules")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "classification_rules",
    rowId: id,
    op: "DELETE",
  });

  revalidatePath("/admin/rules");
  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
}
