"use server";

import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import {
  listTxnsForAccount,
  listTxnsForAccountSet,
} from "@/lib/queries/transactions";
import { drillFromCashbook } from "@/lib/queries/cashbook-pnl";
import { listAccounts } from "@/lib/queries/accounts";
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

const CashbookDrillSchema = z.object({
  accountIds: z.array(z.string().uuid()).min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entityCodes: z.array(z.string()).optional(),
});

/**
 * Drill-down that reads from cashbook_snapshots (Admin API) instead of
 * the transactions table — matches the cashbook-sourced P&L. Rows are
 * synthetic and read-only.
 */
export async function drillDownFromCashbook(
  input: z.input<typeof CashbookDrillSchema>,
) {
  const me = await getCurrentProfile();
  if (!me || !canViewPage(me.role, "pnl")) {
    throw new Error("Forbidden");
  }
  const parsed = CashbookDrillSchema.parse(input);
  const supabase = createDataClient();
  const accounts = await listAccounts(supabase, { activeOnly: true });
  return drillFromCashbook(supabase, {
    accountIds: parsed.accountIds,
    range: { from: parsed.from, to: parsed.to },
    entityCodes: parsed.entityCodes ?? [],
    accounts,
  });
}
