"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const WRITE_ROLES = ["coo", "bookkeeper", "admin"] as const;

const CloseMonthSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  entity: z.string().trim().min(1).max(40),
  cashRevenue: z.number(),
  cashCogs: z.number(),
  accrualRevenue: z.number(),
  accrualCogs: z.number(),
  memo: z.string().trim().max(400).optional(),
});

/**
 * Close a month: optionally post an adjusting journal entry to bring
 * cash-basis numbers up to accrual, then lock the period in
 * `closed_periods`. Mirrors legacy `app.confirmMonthClose()` from
 * legacy/app.js (~line 6191).
 */
export async function closeMonthWithAdjustments(
  input: z.input<typeof CloseMonthSchema>,
): Promise<{ posted: boolean; revenueAdj: number; cogsAdj: number }> {
  const me = await requireRole(WRITE_ROLES);
  const parsed = CloseMonthSchema.parse(input);
  const supabase = createDataClient();

  const revenueAdj = parsed.accrualRevenue - parsed.cashRevenue;
  const cogsAdj = parsed.accrualCogs - parsed.cashCogs;
  const noAdjustments =
    Math.abs(revenueAdj) < 0.01 && Math.abs(cogsAdj) < 0.01;

  let posted = false;
  if (!noAdjustments) {
    const [revRes, cogsRes, entityRes] = await Promise.all([
      supabase
        .from("accounts")
        .select("id")
        .eq("account_type", "revenue")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("accounts")
        .select("id")
        .eq("account_subtype", "cogs")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("entities")
        .select("id")
        .eq("code", parsed.entity)
        .maybeSingle(),
    ]);
    const revenueAcct = revRes.data;
    const cogsAcct = cogsRes.data;
    if (!revenueAcct || !cogsAcct) {
      throw new Error(
        "Could not find revenue or COGS accounts — check Chart of Accounts",
      );
    }

    const [yearStr, monthStr] = parsed.period.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const lastDay = new Date(year, month, 0).getDate();
    const closingDate = `${parsed.period}-${String(lastDay).padStart(2, "0")}`;

    const { data: je, error: jeErr } = await supabase
      .from("journal_entries")
      .insert({
        description: parsed.memo || `Adjusting entry — ${parsed.period}`,
        accounting_date: closingDate,
        entry_type: "adjusting",
        period: parsed.period,
        entity: parsed.entity,
        entity_id: entityRes.data?.id ?? null,
        status: "POSTED",
      })
      .select("id")
      .single();
    if (jeErr || !je) {
      throw new Error(jeErr?.message ?? "Failed to post journal entry");
    }

    const lines: Array<{
      journal_entry_id: string;
      account_id: string;
      debit_amount: number;
      credit_amount: number;
      memo: string;
    }> = [];
    if (Math.abs(revenueAdj) > 0.01) {
      lines.push({
        journal_entry_id: je.id,
        account_id: revenueAcct.id,
        debit_amount: revenueAdj < 0 ? Math.abs(revenueAdj) : 0,
        credit_amount: revenueAdj > 0 ? revenueAdj : 0,
        memo: "Revenue adjustment",
      });
    }
    if (Math.abs(cogsAdj) > 0.01) {
      lines.push({
        journal_entry_id: je.id,
        account_id: cogsAcct.id,
        debit_amount: cogsAdj > 0 ? cogsAdj : 0,
        credit_amount: cogsAdj < 0 ? Math.abs(cogsAdj) : 0,
        memo: "COGS adjustment",
      });
    }
    if (lines.length) {
      const { error: leErr } = await supabase
        .from("ledger_entries")
        .insert(lines);
      if (leErr) throw new Error(leErr.message);
    }
    posted = true;
  }

  const { error: lockErr } = await supabase.from("closed_periods").insert({
    period: parsed.period,
    entity: parsed.entity,
    closed_at: new Date().toISOString(),
  });
  // 23505 = unique violation (period already closed) — tolerate.
  if (lockErr && (lockErr as { code?: string }).code !== "23505") {
    throw new Error(lockErr.message);
  }

  await writeAuditLog({
    actorUserId: me.userId,
    table: "closed_periods",
    op: "INSERT",
    after: {
      period: parsed.period,
      entity: parsed.entity,
      revenueAdj,
      cogsAdj,
      posted,
    },
  });

  revalidatePath("/journals");
  revalidatePath("/pnl");
  return { posted, revenueAdj, cogsAdj };
}
