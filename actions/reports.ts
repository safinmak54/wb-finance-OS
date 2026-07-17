"use server";

import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import {
  listTxnsForAccount,
  listTxnsForAccountSet,
  listBalanceTxnsForAccountSet,
} from "@/lib/queries/transactions";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canViewPage } from "@/lib/auth/permissions";
import type { EntityFilterValue } from "@/lib/entities";

const Schema = z.object({
  accountId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entity: z.string().optional(),
});

/**
 * P&L drill-down: list the transactions backing a single account-line in the
 * current period. Mirrors `app.drillDown()` from legacy/app.js (~line 3726).
 */
export async function drillDownAccount(input: z.input<typeof Schema>) {
  const me = await getCurrentProfile();
  if (!me || !canViewPage(me.role, "pnl")) {
    throw new Error("Forbidden");
  }
  const parsed = Schema.parse(input);

  const supabase = createDataClient();
  return listTxnsForAccount(supabase, {
    accountId: parsed.accountId,
    range: { from: parsed.from, to: parsed.to },
    entity: (parsed.entity ?? "all") as EntityFilterValue,
  });
}

const SetSchema = z.object({
  accountIds: z.array(z.string().uuid()).min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entityCodes: z.array(z.string()).optional(),
});

/** Drill across a set of accounts (section totals, computed rows). Restricts
 *  to the given entity codes (omit/empty = all entities). */
export async function drillDownAccountSet(input: z.input<typeof SetSchema>) {
  const me = await getCurrentProfile();
  if (!me || !canViewPage(me.role, "pnl")) {
    throw new Error("Forbidden");
  }
  const parsed = SetSchema.parse(input);

  const supabase = createDataClient();
  return listTxnsForAccountSet(supabase, {
    accountIds: parsed.accountIds,
    range: { from: parsed.from, to: parsed.to },
    entityCodes: parsed.entityCodes,
  });
}

const BalanceSetSchema = z.object({
  accountIds: z.array(z.string().uuid()).min(1),
  entity: z.string().optional(),
});

/** Balance-sheet drill-down: list every transaction making up a balance line
 *  (cumulative, entity-scoped) — the accounts that compose the clicked row. */
export async function drillDownBalanceAccountSet(
  input: z.input<typeof BalanceSetSchema>,
) {
  const me = await getCurrentProfile();
  if (!me || !canViewPage(me.role, "balance")) {
    throw new Error("Forbidden");
  }
  const parsed = BalanceSetSchema.parse(input);

  const supabase = createDataClient();
  return listBalanceTxnsForAccountSet(supabase, {
    accountIds: parsed.accountIds,
    entity: (parsed.entity ?? "all") as EntityFilterValue,
  });
}

