"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createDataClient } from "@/lib/supabase/data";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canViewPage } from "@/lib/auth/permissions";
import { API_SOURCED_ACCOUNT_CODES } from "@/lib/queries/pnl-manual";

const UpsertSchema = z.object({
  accountId: z.string().uuid(),
  entityCode: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().finite(),
  note: z.string().max(500).optional().nullable(),
});

export async function upsertPnlManualEntry(input: z.input<typeof UpsertSchema>) {
  const me = await getCurrentProfile();
  if (!me || !canViewPage(me.role, "pnl")) {
    throw new Error("Forbidden");
  }
  const parsed = UpsertSchema.parse(input);
  const supabase = createDataClient();

  // Guard: prevent manual override on Admin-API-sourced accounts.
  const { data: acct, error: acctErr } = await supabase
    .from("accounts")
    .select("account_code")
    .eq("id", parsed.accountId)
    .maybeSingle();
  if (acctErr) throw new Error(acctErr.message);
  if (!acct) throw new Error("Account not found");
  if (API_SOURCED_ACCOUNT_CODES.has((acct as { account_code: string }).account_code)) {
    throw new Error(
      `Account ${(acct as { account_code: string }).account_code} is sourced from the Admin API — refresh Cashbook to update it.`,
    );
  }

  // Upsert on the unique (account_id, entity_code, month) key.
  const { error } = await supabase
    .from("pnl_manual_entries")
    .upsert(
      {
        account_id: parsed.accountId,
        entity_code: parsed.entityCode,
        month: parsed.month,
        amount: parsed.amount,
        note: parsed.note ?? null,
        created_by: me.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id,entity_code,month" },
    );
  if (error) throw new Error(error.message);

  revalidatePath("/pnl");
  return { ok: true as const };
}

const DeleteSchema = z.object({
  accountId: z.string().uuid(),
  entityCode: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export async function deletePnlManualEntry(input: z.input<typeof DeleteSchema>) {
  const me = await getCurrentProfile();
  if (!me || !canViewPage(me.role, "pnl")) {
    throw new Error("Forbidden");
  }
  const parsed = DeleteSchema.parse(input);
  const supabase = createDataClient();

  const { error } = await supabase
    .from("pnl_manual_entries")
    .delete()
    .eq("account_id", parsed.accountId)
    .eq("entity_code", parsed.entityCode)
    .eq("month", parsed.month);
  if (error) throw new Error(error.message);

  revalidatePath("/pnl");
  return { ok: true as const };
}
