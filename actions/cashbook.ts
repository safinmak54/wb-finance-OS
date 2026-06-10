"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { fetchPaymentMethodReport, fetchSalesSummaryLive } from "@/lib/admin-api/reports";
import { AdminApiError } from "@/lib/admin-api/errors";
import {
  buildPaymentMethodJournals,
  buildSalesSummaryJournal,
  buildSalesSummaryJournalsByCompany,
  type JournalSpec,
} from "@/lib/admin-api/journal-mapping";
import {
  PaymentMethodReport as PaymentMethodSchema,
  SalesSummaryReport as SalesSummarySchema,
  SalesSummarySnapshot as SalesSummarySnapshotSchema,
} from "@/lib/admin-api/schemas";
import {
  synthesizeTransactionRows,
  SYNTHESIZED_ACCOUNT_CODES,
} from "@/lib/admin-api/synthesize-transactions";
import { getLatestSnapshots } from "@/lib/queries/cashbook";
import { entityCodeToId } from "@/lib/queries/entities";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const REFRESH_ROLES = ["coo", "cpa", "admin"] as const;
const GENERATE_ROLES = ["coo", "cpa", "admin"] as const;

/**
 * Recursively sort object keys so two payloads with the same content but
 * different key ordering hash identically. Used for the snapshot checksum.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = canonicalize(obj[k]);
    return out;
  }
  return value;
}

/** SHA-256 of the canonicalized payload — stable across re-fetches. */
function payloadChecksum(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

/** Split an array into fixed-size chunks (last chunk may be smaller). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// `raw_transactions` and `transactions` both carry a per-row AFTER trigger
// (audit_capture, migration 0004). Every row in a bulk insert/update/delete
// fires it once, so a YTD sync's thousands of rows must be split across many
// small statements — a single statement over the whole set overruns the DB
// request timeout. This bounds the rows touched per statement.
const DB_BATCH_SIZE = 500;

const RefreshSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "startDate must be on or before endDate",
  });

export type RefreshCashbookResult = {
  ok: true;
  startDate: string;
  endDate: string;
  fetchedAt: string;
  /** Sources whose payload changed and were re-synthesized. */
  changedSources: string[];
  /** Sources whose checksum matched the last sync and were skipped. */
  skippedSources: string[];
  transactionsInserted: number;
};

export async function refreshCashbookSnapshot(
  input: z.input<typeof RefreshSchema>,
): Promise<RefreshCashbookResult> {
  const me = await requireRole(REFRESH_ROLES);
  const parsed = RefreshSchema.parse(input);

  let paymentMethod;
  let salesSummaryAggregate;
  try {
    [paymentMethod, salesSummaryAggregate] = await Promise.all([
      fetchPaymentMethodReport({
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        mode: "company",
      }),
      fetchSalesSummaryLive({
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        groupBy: "day",
        segment: "all",
      }),
    ]);
  } catch (e) {
    if (e instanceof AdminApiError) {
      throw new Error(e.userMessage);
    }
    throw e;
  }

  // Per-entity sales summary: one extra call per company that showed up in
  // the payment-method snapshot. Done in parallel after the aggregate so we
  // know which company_ids to ask about. Note: when companyIds is set, the
  // channel-split fields (net_sales_asi etc.) come back null — that's
  // expected (see Admin API guide §3.5).
  const companyIds = paymentMethod.totals.companies.map((c) => c.company_id);
  let salesSummaryByCompany: Record<string, typeof salesSummaryAggregate> = {};
  try {
    const perCompany = await Promise.all(
      companyIds.map((id) =>
        fetchSalesSummaryLive({
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          groupBy: "day",
          segment: "all",
          companyIds: [id],
        }).then((res) => [id, res] as const),
      ),
    );
    salesSummaryByCompany = Object.fromEntries(
      perCompany.map(([id, res]) => [String(id), res]),
    );
  } catch (e) {
    if (e instanceof AdminApiError) {
      throw new Error(`Per-entity sales-summary fetch failed: ${e.userMessage}`);
    }
    throw e;
  }

  const salesSummary = {
    aggregate: salesSummaryAggregate,
    byCompany: salesSummaryByCompany,
  };

  const supabase = createDataClient();
  const fetchedAt = new Date().toISOString();

  // Resolve account + entity maps once; both sources synthesize through them.
  const [acctRes, entityIdsMap] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, account_code")
      .in("account_code", SYNTHESIZED_ACCOUNT_CODES as string[]),
    entityCodeToId(supabase),
  ]);
  if (acctRes.error) throw new Error(acctRes.error.message);
  const codeToId = new Map<string, string>();
  for (const a of acctRes.data ?? []) {
    codeToId.set(
      (a as { account_code: string }).account_code,
      (a as { id: string }).id,
    );
  }

  const sources: Array<{
    source: "payment_method" | "sales_summary";
    payload: unknown;
  }> = [
    { source: "payment_method", payload: paymentMethod },
    { source: "sales_summary", payload: salesSummary },
  ];

  let txnInsertCount = 0;
  const changedSources: string[] = [];
  const skippedSources: string[] = [];

  for (const { source, payload } of sources) {
    const checksum = payloadChecksum(payload);
    const txnSource = `admin_api:${source}`;

    // Prior snapshots for this exact (period, source), newest first. Used
    // for the checksum fast-path and to keep a single snapshot row per
    // fetched range.
    const { data: existing, error: existErr } = await supabase
      .from("cashbook_snapshots")
      .select("id, payload_checksum")
      .eq("period_start", parsed.startDate)
      .eq("period_end", parsed.endDate)
      .eq("source", source)
      .order("fetched_at", { ascending: false });
    if (existErr) throw new Error(existErr.message);

    const latest = existing?.[0] as
      | { id: string; payload_checksum: string | null }
      | undefined;
    if (latest && latest.payload_checksum === checksum) {
      // Payload is byte-for-byte what we already have — nothing to do.
      skippedSources.push(source);
      continue;
    }

    // --- Day-grain replacement (overlap-safe) ---
    // Synthesized rows are keyed by day (source × entity × account ×
    // acc_date), so this sync authoritatively owns every admin row for
    // `txnSource` whose accounting date falls in [startDate, endDate].
    // Delete them all before re-inserting, regardless of which snapshot
    // produced them. This is what keeps OVERLAPPING syncs from
    // double-counting: a YTD refresh and a single-month refresh both
    // touch June, but each day ends up represented exactly once — by
    // whichever sync ran last.
    //
    // We delete by DATE RANGE, not by snapshot id, on purpose: a narrow
    // sync replaces only the days it actually re-fetched and never drops
    // data a wider prior sync brought in. (Syncing June after a YTD sync
    // leaves the Jan–May rows untouched; syncing YTD after a June sync
    // re-claims June.) Keying off the requested period instead would
    // either double-count overlaps or silently lose the non-overlapping
    // tail.
    //
    // Order respects the FKs (transactions → raw_transactions); both
    // carry per-row audit triggers, so delete in bounded chunks.
    const { data: staleTxns, error: staleErr } = await supabase
      .from("transactions")
      .select("id, raw_transaction_id")
      .eq("source", txnSource)
      .gte("acc_date", parsed.startDate)
      .lte("acc_date", parsed.endDate);
    if (staleErr) throw new Error(staleErr.message);
    const staleTxnIds = (staleTxns ?? []).map((t) => (t as { id: string }).id);
    const staleRawIds = (staleTxns ?? [])
      .map(
        (t) => (t as { raw_transaction_id: string | null }).raw_transaction_id,
      )
      .filter((id): id is string => !!id);
    for (const ids of chunk(staleTxnIds, DB_BATCH_SIZE)) {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .in("id", ids);
      if (error) throw new Error(error.message);
    }
    for (const ids of chunk(staleRawIds, DB_BATCH_SIZE)) {
      const { error } = await supabase
        .from("raw_transactions")
        .delete()
        .in("id", ids);
      if (error) throw new Error(error.message);
    }

    // Drop prior snapshot rows for this exact (period, source). Their
    // transactions all fall within [startDate, endDate], so they were
    // just removed by the day-grain delete above and the snapshot rows
    // have no remaining children. (Snapshots from *other* periods that
    // overlap this range keep their rows — only their now-replaced days
    // were deleted, which is exactly what we want.)
    const oldSnapIds = (existing ?? []).map((e) => (e as { id: string }).id);
    if (oldSnapIds.length > 0) {
      const { error: delSnapErr } = await supabase
        .from("cashbook_snapshots")
        .delete()
        .in("id", oldSnapIds);
      if (delSnapErr) throw new Error(delSnapErr.message);
    }

    const { data: insertedSnap, error: insErr } = await supabase
      .from("cashbook_snapshots")
      .insert({
        period_start: parsed.startDate,
        period_end: parsed.endDate,
        source,
        payload: payload as never,
        payload_checksum: checksum,
        fetched_at: fetchedAt,
        fetched_by: me.userId,
      })
      .select("id, source, payload")
      .single();
    if (insErr || !insertedSnap) {
      throw new Error(insErr?.message ?? "snapshot insert failed");
    }
    changedSources.push(source);

    // Persist each API line as a `raw_transactions` row (classified=false)
    // so it enters the inbox like any other import. Immediately afterwards
    // we auto-classify each row to its known account code — the synthesizer
    // mapping (Stripe → 4040, etc.) acts as the auto-rule, going through
    // the standard classification path that creates the `transactions` row.
    const snapId = (insertedSnap as { id: string }).id;
    const result = synthesizeTransactionRows(
      {
        id: snapId,
        source,
        payload: (insertedSnap as { payload: unknown }).payload,
      },
      codeToId,
      entityIdsMap,
    );
    if (result.rows.length === 0) continue;

    // Auto-classify by building `transactions` rows directly (one per raw)
    // and flipping classified=true on the raw rows. This is the same shape
    // `classifyTransaction` produces, batched. `source` is what the
    // day-grain delete above keys off to keep overlapping syncs from
    // double-counting; cashbook_snapshot_id ties each row back to the fetch
    // that produced it (audit + transactions_pnl's latest-snapshot filter).
    //
    // Process in bounded chunks: `raw_transactions` and `transactions` both
    // carry a per-row AFTER trigger (audit_capture, migration 0004), so each
    // bulk statement fires the trigger once per row. A YTD sync synthesizes
    // thousands of rows; a single `UPDATE ... WHERE id IN (<thousands>)`
    // fires thousands of triggers in one statement and overruns the DB
    // request timeout. Chunking keeps every statement small and fast.
    const classifiedAt = new Date().toISOString();

    for (const slice of chunk(result.rows, DB_BATCH_SIZE)) {
      const { data: insertedRaw, error: rawErr } = await supabase
        .from("raw_transactions")
        .insert(slice.map((r) => r.raw))
        .select("id, accounting_date, transaction_date, description, direction, amount");
      if (rawErr) throw new Error(rawErr.message);
      if (!insertedRaw || insertedRaw.length !== slice.length) {
        throw new Error(
          `raw_transactions insert returned ${insertedRaw?.length ?? 0} rows, expected ${slice.length}`,
        );
      }

      const txnInserts = slice.map((synth, i) => {
        const raw = insertedRaw[i] as {
          id: string;
          accounting_date: string | null;
          transaction_date: string;
          description: string | null;
          direction: "DEBIT" | "CREDIT";
          amount: number;
        };
        const signedAmount =
          raw.direction === "DEBIT"
            ? -Math.abs(Number(raw.amount))
            : Math.abs(Number(raw.amount));
        return {
          raw_transaction_id: raw.id,
          entity: synth.entityCode,
          account_id: codeToId.get(synth.accountCode) ?? null,
          amount: signedAmount,
          txn_date: raw.transaction_date,
          acc_date: raw.accounting_date ?? raw.transaction_date,
          description: raw.description ?? "",
          memo: "",
          cashbook_snapshot_id: snapId,
          source: txnSource,
        };
      });
      const { error: txnErr } = await supabase
        .from("transactions")
        .insert(txnInserts);
      if (txnErr) throw new Error(txnErr.message);

      const rawIds = insertedRaw.map((r) => (r as { id: string }).id);
      const { error: flipErr } = await supabase
        .from("raw_transactions")
        .update({ classified: true, classified_at: classifiedAt })
        .in("id", rawIds);
      if (flipErr) {
        throw new Error(
          flipErr.message ||
            `raw_transactions classify-flip failed for ${rawIds.length} rows`,
        );
      }
      txnInsertCount += txnInserts.length;
    }
  }

  await writeAuditLog({
    actorUserId: me.userId,
    table: "cashbook_snapshots",
    op: "INSERT",
    after: {
      period_start: parsed.startDate,
      period_end: parsed.endDate,
      changed_sources: changedSources,
      skipped_sources: skippedSources,
      fetched_at: fetchedAt,
      transactions_inserted: txnInsertCount,
    },
  });

  revalidatePath("/cashbook");
  revalidatePath("/pnl");
  revalidatePath("/ledger");
  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");

  return {
    ok: true,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    fetchedAt,
    changedSources,
    skippedSources,
    transactionsInserted: txnInsertCount,
  };
}

const GenerateSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: "startDate must be on or before endDate",
  });

export type GenerateCashbookResult = {
  ok: true;
  createdCount: number;
  createdIds: string[];
  skippedCompanyIds: number[];
};

/**
 * Convert the latest cashbook snapshots for a date range into draft
 * journal entries (one JE per entity for revenue/refunds, plus one
 * consolidated JE on `WB` for COGS + ad spend). Drafts are inserted —
 * the user reviews and posts them via the Journals page.
 *
 * Refuses to run if drafts from a prior generation for the same period
 * still exist; the user must delete them first to avoid duplicates.
 */
export async function generateCashbookJournals(
  input: z.input<typeof GenerateSchema>,
): Promise<GenerateCashbookResult> {
  const me = await requireRole(GENERATE_ROLES);
  const parsed = GenerateSchema.parse(input);
  const supabase = createDataClient();

  const snaps = await getLatestSnapshots(supabase, {
    startDate: parsed.startDate,
    endDate: parsed.endDate,
  });
  if (!snaps.paymentMethod && !snaps.salesSummary) {
    throw new Error(
      "No snapshot for this range yet. Click 'Refresh from Admin API' first.",
    );
  }

  // Validate the JSONB payloads against the schemas before mapping. The
  // snapshots came from the API at some point; the API shape may have
  // shifted between fetch and now.
  let paymentMethod = snaps.paymentMethod
    ? PaymentMethodSchema.parse(snaps.paymentMethod.payload)
    : null;
  // Sales summary may be either the new wrapper shape ({aggregate, byCompany})
  // or a legacy raw SalesSummaryReport. Prefer per-entity (byCompany) when
  // available; fall back to a consolidated WB-only JE for legacy snapshots.
  let salesSummary: import("@/lib/admin-api/schemas").SalesSummaryReport | null =
    null;
  let salesSummarySnapshot: import("@/lib/admin-api/schemas").SalesSummarySnapshot | null =
    null;
  if (snaps.salesSummary) {
    const wrapper = SalesSummarySnapshotSchema.safeParse(
      snaps.salesSummary.payload,
    );
    if (wrapper.success) {
      salesSummarySnapshot = wrapper.data;
      salesSummary = wrapper.data.aggregate;
    } else {
      salesSummary = SalesSummarySchema.parse(snaps.salesSummary.payload);
    }
  }

  // Use the period's last day as the accounting date.
  const accountingDate = parsed.endDate;
  const period = accountingDate.slice(0, 7);

  const specs: JournalSpec[] = [];
  let skippedCompanyIds: number[] = [];

  if (paymentMethod) {
    const built = buildPaymentMethodJournals(paymentMethod, accountingDate);
    specs.push(...built.journals);
    skippedCompanyIds = built.skippedCompanyIds;
  }
  // Per-entity COGS+ads is the preferred path. Fall back to a consolidated
  // WB JE only if the snapshot pre-dates the byCompany wrapper.
  if (salesSummarySnapshot) {
    const built = buildSalesSummaryJournalsByCompany(
      salesSummarySnapshot,
      accountingDate,
    );
    specs.push(...built.journals);
    skippedCompanyIds = Array.from(
      new Set([...skippedCompanyIds, ...built.skippedCompanyIds]),
    );
  } else if (salesSummary) {
    const ssj = buildSalesSummaryJournal(salesSummary, accountingDate, "WB");
    if (ssj) specs.push(ssj);
  }

  if (specs.length === 0) {
    throw new Error("Nothing to post — all amounts are zero.");
  }

  // Idempotency guard: refuse if any draft JE we previously generated
  // for this period still exists. We tag generated entries with the
  // [ADMIN_API] prefix in the description so we can find them again
  // without relying on the `source` column (which isn't on the
  // production schema).
  const ADMIN_TAG = "[ADMIN_API]";
  const { data: existing, error: existingErr } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("period", period)
    .eq("status", "draft")
    .ilike("description", `${ADMIN_TAG}%`)
    .limit(1);
  if (existingErr) throw new Error(existingErr.message);
  if (existing && existing.length > 0) {
    throw new Error(
      `Draft journal entries already exist for ${period}. Delete them on the Journals page before regenerating.`,
    );
  }

  // Resolve all account_codes to ids in one query.
  const codes = Array.from(
    new Set(specs.flatMap((s) => s.lines.map((l) => l.account_code))),
  );
  const { data: accountRows, error: acctErr } = await supabase
    .from("accounts")
    .select("id, account_code")
    .in("account_code", codes);
  if (acctErr) throw new Error(acctErr.message);
  const codeToId: Record<string, string> = {};
  for (const a of accountRows ?? []) {
    codeToId[(a as { account_code: string }).account_code] =
      (a as { id: string }).id;
  }
  const missing = codes.filter((c) => !codeToId[c]);
  if (missing.length > 0) {
    throw new Error(
      `Missing accounts in chart of accounts: ${missing.join(", ")}. Run migration 0006.`,
    );
  }

  const entityIds = await entityCodeToId(supabase);
  for (const s of specs) {
    if (!entityIds[s.entity]) {
      throw new Error(`Entity '${s.entity}' not found in entities table.`);
    }
  }

  const createdIds: string[] = [];
  for (const spec of specs) {
    const dr = spec.lines.reduce((sum, l) => sum + l.debit, 0);
    const cr = spec.lines.reduce((sum, l) => sum + l.credit, 0);
    if (Math.abs(dr - cr) > 0.01) {
      throw new Error(
        `Unbalanced JE for ${spec.entity}: debits ${dr.toFixed(2)} ≠ credits ${cr.toFixed(2)}`,
      );
    }

    const taggedDescription = `${ADMIN_TAG} ${spec.description}`;
    const { data: je, error: jeErr } = await supabase
      .from("journal_entries")
      .insert({
        accounting_date: spec.accounting_date,
        description: taggedDescription,
        entity: spec.entity,
        entity_id: entityIds[spec.entity],
        entry_type: spec.entry_type,
        period,
        status: spec.status,
      })
      .select("id")
      .single();
    if (jeErr || !je) throw new Error(jeErr?.message ?? "JE insert failed");

    const lineRows = spec.lines.map((l) => ({
      journal_entry_id: (je as { id: string }).id,
      account_id: codeToId[l.account_code],
      debit_amount: l.debit,
      credit_amount: l.credit,
      memo: l.memo,
    }));
    const { error: leErr } = await supabase
      .from("ledger_entries")
      .insert(lineRows);
    if (leErr) throw new Error(leErr.message);

    createdIds.push((je as { id: string }).id);
  }

  await writeAuditLog({
    actorUserId: me.userId,
    table: "journal_entries",
    op: "INSERT",
    after: {
      source: "ADMIN_API",
      period,
      count: createdIds.length,
      ids: createdIds,
    },
  });

  revalidatePath("/cashbook");
  revalidatePath("/journals");

  return {
    ok: true,
    createdCount: createdIds.length,
    createdIds,
    skippedCompanyIds,
  };
}

export type DeleteAdminApiResult = {
  ok: true;
  transactionsDeleted: number;
  rawTransactionsDeleted: number;
};

/**
 * Delete every transaction sourced from the Admin API — both the
 * `transactions` ledger rows (source like 'admin_api:%') and their
 * paired `raw_transactions` rows (source = 'admin_api'). Snapshots in
 * `cashbook_snapshots` are left untouched so the raw payloads remain
 * available for re-synthesis via Refresh.
 */
export async function deleteAdminApiTransactions(): Promise<DeleteAdminApiResult> {
  const me = await requireRole(REFRESH_ROLES);
  const supabase = createDataClient();

  // Delete ledger rows first; raw rows next. Order matters in case
  // `transactions.raw_transaction_id` is constrained with a non-cascade FK.
  // Pre-fix rows had transactions.source NULL, so we sweep via the
  // raw_transaction_id link (the only reliable marker) and also include
  // newer rows tagged with source='admin_api:%' that lost their raw link.
  const { data: rawIdsRows, error: rawIdsErr } = await supabase
    .from("raw_transactions")
    .select("id")
    .eq("source", "admin_api");
  if (rawIdsErr) throw new Error(rawIdsErr.message);
  const rawIds = (rawIdsRows ?? []).map((r) => (r as { id: string }).id);

  let txnCount = 0;
  if (rawIds.length > 0) {
    const { count, error } = await supabase
      .from("transactions")
      .delete({ count: "exact" })
      .in("raw_transaction_id", rawIds);
    if (error) throw new Error(error.message);
    txnCount += count ?? 0;
  }
  // Catch any stragglers tagged by source but missing a raw link.
  {
    const { count, error } = await supabase
      .from("transactions")
      .delete({ count: "exact" })
      .like("source", "admin_api:%");
    if (error) throw new Error(error.message);
    txnCount += count ?? 0;
  }

  const { count: rawCount, error: rawErr } = await supabase
    .from("raw_transactions")
    .delete({ count: "exact" })
    .eq("source", "admin_api");
  if (rawErr) throw new Error(rawErr.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "transactions",
    op: "DELETE",
    after: {
      source: "ADMIN_API",
      transactions_deleted: txnCount ?? 0,
      raw_transactions_deleted: rawCount ?? 0,
    },
  });

  revalidatePath("/cashbook");
  revalidatePath("/pnl");
  revalidatePath("/ledger");
  revalidatePath("/inbox");
  revalidatePath("/cc-inbox");

  return {
    ok: true,
    transactionsDeleted: txnCount ?? 0,
    rawTransactionsDeleted: rawCount ?? 0,
  };
}
