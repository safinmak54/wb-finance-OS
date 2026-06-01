"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";
import { classifyMany } from "@/lib/classify-rules";
import { listClassificationRules } from "@/lib/queries/classify";
import { listUnclassifiedBank, listUnclassifiedCC } from "@/lib/queries/transactions";
import { entityCodeToId } from "@/lib/queries/entities";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { bulkClassifyTransactions } from "./transactions";

const RULE_ROLES = ["admin"] as const;
const AUTO_TAG_ROLES = ["bookkeeper", "admin"] as const;

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

  // NOTE: the live `classification_rules` table has no `vendor_id` column,
  // so it is intentionally omitted from the write payload. Sending it makes
  // PostgREST reject the insert/update with PGRST204.
  //
  // `name` is a NOT NULL column on the live table (the legacy app populated
  // it). The new UI only collects a pattern, so we mirror the pattern into
  // `name`; otherwise the insert fails the not-null constraint.
  const payload = {
    name: parsed.pattern,
    pattern: parsed.pattern,
    account_id: parsed.account_id,
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

const BulkAutoTagSchema = z.object({
  entity: z.string().optional(),
  source: z.enum(["bank", "cc"]).default("bank"),
});

/** Run classification rules over all unclassified rows in scope and
 *  commit the ones that matched a rule with a complete (account+entity)
 *  picture. Rows missing an entity are skipped (we can't post without
 *  one). */
export async function bulkAutoTag(
  input: z.input<typeof BulkAutoTagSchema>,
): Promise<{ tagged: number; skipped: number }> {
  await requireRole(AUTO_TAG_ROLES);
  const parsed = BulkAutoTagSchema.parse(input);

  const supabase = createDataClient();
  const codeToId = await entityCodeToId(supabase);
  const idToCode: Record<string, string> = {};
  for (const [code, id] of Object.entries(codeToId)) idToCode[id] = code;

  const entity = entityFilterFromSearchParams({
    entity: parsed.entity,
  });

  const rows =
    parsed.source === "bank"
      ? await listUnclassifiedBank(supabase, { entity, codeToId })
      : await listUnclassifiedCC(supabase, { entity, codeToId });

  const rules = await listClassificationRules(supabase);
  const hits = classifyMany(rows, rules);

  const targets: { rawId: string; accountId: string; entityCode: string }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const hit = hits.get(r.id);
    if (!hit || !hit.accountId) {
      skipped += 1;
      continue;
    }
    const entityCode = r.entity_id ? idToCode[r.entity_id] : null;
    if (!entityCode) {
      skipped += 1;
      continue;
    }
    targets.push({
      rawId: r.id,
      accountId: hit.accountId,
      entityCode,
    });
  }

  if (targets.length === 0) {
    return { tagged: 0, skipped };
  }

  // bulkClassifyTransactions caps at 500 rows per call; chunk if needed.
  const CHUNK = 500;
  for (let i = 0; i < targets.length; i += CHUNK) {
    await bulkClassifyTransactions({ rows: targets.slice(i, i + CHUNK) });
  }

  return { tagged: targets.length, skipped };
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
