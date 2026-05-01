"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";
import { parseSpreadsheet, detectColumns } from "@/lib/import/parse";
import { normalizeDate } from "@/lib/format";
import {
  detectEntityFromBankAccount,
  type EntityCode,
} from "@/lib/entities";

const IMPORT_ROLES = ["bookkeeper", "admin"] as const;

export type ParsePreview = {
  headers: string[];
  sampleRows: string[][];
  detected: ReturnType<typeof detectColumns>;
};

/**
 * Parse the uploaded file and return a preview without inserting
 * anything yet. The client uses this to show the column-mapping UI.
 */
export async function previewImport(
  formData: FormData,
): Promise<ParsePreview> {
  await requireRole(IMPORT_ROLES);

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");
  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = await parseSpreadsheet(file.name, buf);
  return {
    headers: parsed.headers,
    sampleRows: parsed.rows.slice(0, 10),
    detected: detectColumns(parsed.headers),
  };
}

const SubmitSchema = z.object({
  source: z.enum(["bank", "credit_card"]),
  defaultEntity: z.string().trim().min(1).max(40).optional(),
  mapping: z.object({
    date: z.number().int().nonnegative(),
    description: z.number().int().nonnegative(),
    amount: z.number().int(),
    debit: z.number().int(),
    credit: z.number().int(),
    vendor: z.number().int(),
  }),
});

export async function commitImport(
  formData: FormData,
): Promise<{ inserted: number; skipped: number }> {
  const me = await requireRole(IMPORT_ROLES);

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const meta = SubmitSchema.parse(JSON.parse(String(formData.get("meta"))));

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = await parseSpreadsheet(file.name, buf);

  const supabase = createDataClient();
  const { data: entitiesData } = await supabase
    .from("entities")
    .select("id, code");
  const codeToId: Record<string, string> = {};
  for (const e of entitiesData ?? []) codeToId[e.code] = e.id;

  const inserts: Array<{
    entity_id: string | null;
    source: string;
    external_id: string | null;
    transaction_date: string;
    accounting_date: string;
    amount: number;
    direction: "DEBIT" | "CREDIT";
    description: string | null;
    vendor: string | null;
    txn_type: string | null;
    category: string | null;
    status: string;
    classified: boolean;
  }> = [];

  let skipped = 0;
  for (const row of parsed.rows) {
    const dateRaw = row[meta.mapping.date] ?? "";
    const date = normalizeDate(dateRaw);
    if (!date) {
      skipped += 1;
      continue;
    }

    const desc = (row[meta.mapping.description] ?? "").trim();
    const vendor = meta.mapping.vendor >= 0 ? row[meta.mapping.vendor] ?? "" : "";

    let amount: number;
    let direction: "DEBIT" | "CREDIT";

    if (meta.mapping.amount >= 0) {
      const raw = Number(
        String(row[meta.mapping.amount] ?? "")
          .replace(/[$,()]/g, "")
          .trim() || "0",
      );
      amount = Math.abs(raw);
      direction = raw < 0 ? "DEBIT" : "CREDIT";
    } else {
      const debit = Number(
        String(row[meta.mapping.debit] ?? "")
          .replace(/[$,()]/g, "")
          .trim() || "0",
      );
      const credit = Number(
        String(row[meta.mapping.credit] ?? "")
          .replace(/[$,()]/g, "")
          .trim() || "0",
      );
      if (debit > 0) {
        amount = debit;
        direction = "DEBIT";
      } else if (credit > 0) {
        amount = credit;
        direction = "CREDIT";
      } else {
        skipped += 1;
        continue;
      }
    }
    if (amount === 0) {
      skipped += 1;
      continue;
    }

    // Per-row entity detection from description, fallback to default
    const detected = detectEntityFromBankAccount(`${desc} ${vendor}`);
    const entityCode =
      (detected as EntityCode | null) ??
      (meta.defaultEntity as EntityCode | undefined) ??
      null;
    const entity_id = entityCode ? codeToId[entityCode] ?? null : null;

    inserts.push({
      entity_id,
      source: meta.source,
      external_id: null,
      transaction_date: date,
      accounting_date: date,
      amount,
      direction,
      description: desc || null,
      vendor: vendor || null,
      txn_type: meta.source === "credit_card" ? "expense" : null,
      category: null,
      status: "review",
      classified: false,
    });
  }

  let inserted = 0;
  if (inserts.length > 0) {
    const { error, count } = await supabase
      .from("raw_transactions")
      .insert(inserts, { count: "exact" });
    if (error) throw new Error(error.message);
    inserted = count ?? inserts.length;
  }

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    op: "INSERT",
    after: { imported: inserted, source: meta.source },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");

  return { inserted, skipped };
}
