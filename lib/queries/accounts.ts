import type { Sb } from "./_client";
import type { Account } from "@/lib/supabase/types";
import { sumTxnsForAccount, type SignedTxn } from "@/lib/account-balance";

export async function listAccounts(
  supabase: Sb,
  opts: { activeOnly?: boolean } = {},
): Promise<Account[]> {
  let q = supabase.from("accounts").select("*").order("account_code");
  if (opts.activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export type AccountWithBalance = Account & { balance: number };

/**
 * Returns every account joined with its current ledger balance,
 * computed from the `transactions` table over the requested period.
 */
export async function listAccountsWithBalances(
  supabase: Sb,
  range?: { from: string; to: string },
): Promise<AccountWithBalance[]> {
  const accounts = await listAccounts(supabase, { activeOnly: false });

  let q = supabase
    .from("transactions")
    .select("amount, account_id");
  if (range) {
    q = q.gte("acc_date", range.from).lte("acc_date", range.to);
  }
  const { data: txns, error } = await q;
  if (error) throw error;

  const signed = (txns ?? []) as SignedTxn[];
  return accounts.map((a) => ({
    ...a,
    balance: sumTxnsForAccount(a, signed),
  }));
}
