"use server";

import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { listTxnsForAccount } from "@/lib/queries/transactions";
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
