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
import { detectDirectionFromDescription } from "@/lib/import/direction";

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
  bankConnectionId: z.string().uuid().optional(),
  mapping: z.object({
    date: z.number().int().nonnegative(),
    description: z.number().int().nonnegative(),
    amount: z.number().int().nonnegative(),
    type: z.number().int(),
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
    bank_connection_id: string | null;
    transaction_date: string;
    accounting_date: string;
    amount: number;
    direction: "DEBIT" | "CREDIT";
    description: string | null;
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
    const typeCell =
      meta.mapping.type >= 0 ? (row[meta.mapping.type] ?? "").trim() : "";

    const rawSigned = Number(
      String(row[meta.mapping.amount] ?? "")
        .replace(/[$,()]/g, "")
        .trim() || "0",
    );
    const amount = Math.abs(rawSigned);
    if (amount === 0) {
      skipped += 1;
      continue;
    }

    // Direction comes from the Type column first (e.g. "ACH DEBIT",
    // "WIRE TRANSFER CREDIT"), then from the description as a fallback,
    // and finally from the amount sign if no pattern matched.
    const direction: "DEBIT" | "CREDIT" =
      detectDirectionFromDescription(typeCell) ??
      detectDirectionFromDescription(`${desc} ${vendor}`) ??
      (rawSigned < 0 ? "DEBIT" : "CREDIT");

    // Per-row entity detection from description, fallback to default
    const detected = detectEntityFromBankAccount(`${desc} ${vendor}`);
    const entityCode =
      (detected as EntityCode | null) ??
      (meta.defaultEntity as EntityCode | undefined) ??
      null;
    const entity_id = entityCode ? codeToId[entityCode] ?? null : null;

    const descWithVendor = vendor && !desc.includes(vendor)
      ? `${desc} · ${vendor}`.trim()
      : desc;

    inserts.push({
      entity_id,
      source: meta.source,
      bank_connection_id: meta.bankConnectionId ?? null,
      transaction_date: date,
      accounting_date: date,
      amount,
      direction,
      description: descWithVendor || null,
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

/**
 * Wipe every row from `transactions` and `raw_transactions`. Admin only;
 * irreversible. Returns the row counts that were deleted.
 */
export async function deleteAllTransactions(): Promise<{
  transactions: number;
  rawTransactions: number;
}> {
  const me = await requireRole(["admin"]);
  const supabase = createDataClient();

  const { count: txCount, error: txErr } = await supabase
    .from("transactions")
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (txErr) throw new Error(txErr.message);

  const { count: rawCount, error: rawErr } = await supabase
    .from("raw_transactions")
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (rawErr) throw new Error(rawErr.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    op: "DELETE",
    after: {
      bulk_wipe: true,
      transactions: txCount ?? 0,
      raw_transactions: rawCount ?? 0,
    },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
  revalidatePath("/import");

  return {
    transactions: txCount ?? 0,
    rawTransactions: rawCount ?? 0,
  };
}

/**
 * Full reset: wipe every row from `transactions`, `raw_transactions`, and
 * `cashbook_snapshots`. The `transactions_pnl` and `cashbook_snapshots_latest`
 * views are derived from those base tables, so they clear automatically —
 * there's nothing to delete from a view directly. Admin only; irreversible.
 */
export async function deleteAllFinancialData(): Promise<{
  transactions: number;
  rawTransactions: number;
  cashbookSnapshots: number;
}> {
  const me = await requireRole(["admin"]);
  const supabase = createDataClient();

  // Order matters: clear `transactions` (which references raw rows via
  // raw_transaction_id) before `raw_transactions`, in case the FK is
  // non-cascading. Snapshots are independent.
  const { count: txCount, error: txErr } = await supabase
    .from("transactions")
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (txErr) throw new Error(txErr.message);

  const { count: rawCount, error: rawErr } = await supabase
    .from("raw_transactions")
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (rawErr) throw new Error(rawErr.message);

  const { count: snapCount, error: snapErr } = await supabase
    .from("cashbook_snapshots")
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (snapErr) throw new Error(snapErr.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "raw_transactions",
    op: "DELETE",
    after: {
      full_reset: true,
      transactions: txCount ?? 0,
      raw_transactions: rawCount ?? 0,
      cashbook_snapshots: snapCount ?? 0,
    },
  });

  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");
  revalidatePath("/import");
  revalidatePath("/cashbook");
  revalidatePath("/pnl");
  revalidatePath("/ledger");

  return {
    transactions: txCount ?? 0,
    rawTransactions: rawCount ?? 0,
    cashbookSnapshots: snapCount ?? 0,
  };
}
