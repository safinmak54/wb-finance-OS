"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { fetchPaymentMethodReport, fetchSalesSummaryLive } from "@/lib/admin-api/reports";
import { AdminApiError } from "@/lib/admin-api/errors";
import {
  buildPaymentMethodJournals,
  buildSalesSummaryJournal,
  type JournalSpec,
} from "@/lib/admin-api/journal-mapping";
import {
  PaymentMethodReport as PaymentMethodSchema,
  SalesSummaryReport as SalesSummarySchema,
  SalesSummarySnapshot as SalesSummarySnapshotSchema,
} from "@/lib/admin-api/schemas";
import { getLatestSnapshots } from "@/lib/queries/cashbook";
import { entityCodeToId } from "@/lib/queries/entities";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const REFRESH_ROLES = ["coo", "cpa", "admin"] as const;
const GENERATE_ROLES = ["coo", "cpa", "admin"] as const;

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
        groupBy: "month",
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
          groupBy: "month",
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

  const rows = [
    {
      period_start: parsed.startDate,
      period_end: parsed.endDate,
      source: "payment_method" as const,
      payload: paymentMethod,
      fetched_at: fetchedAt,
      fetched_by: me.userId,
    },
    {
      period_start: parsed.startDate,
      period_end: parsed.endDate,
      source: "sales_summary" as const,
      payload: salesSummary,
      fetched_at: fetchedAt,
      fetched_by: me.userId,
    },
  ];

  const { error } = await supabase.from("cashbook_snapshots").insert(rows);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "cashbook_snapshots",
    op: "INSERT",
    after: {
      period_start: parsed.startDate,
      period_end: parsed.endDate,
      sources: ["payment_method", "sales_summary"],
      fetched_at: fetchedAt,
    },
  });

  revalidatePath("/cashbook");

  return {
    ok: true,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    fetchedAt,
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
  // Sales summary snapshot may be either the new wrapper shape
  // ({ aggregate, byCompany }) or a legacy raw SalesSummaryReport. Try the
  // wrapper first; fall through to raw. Journal generation always uses the
  // aggregate (consolidated) — it posts a single WB-entity JE.
  let salesSummary: import("@/lib/admin-api/schemas").SalesSummaryReport | null =
    null;
  if (snaps.salesSummary) {
    const wrapper = SalesSummarySnapshotSchema.safeParse(
      snaps.salesSummary.payload,
    );
    if (wrapper.success) {
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
  if (salesSummary) {
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
