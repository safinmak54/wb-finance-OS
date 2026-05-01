import type { Sb } from "./_client";
import type { CashBalance, BankConnection } from "@/lib/supabase/types";

export async function listCashBalances(supabase: Sb): Promise<CashBalance[]> {
  const { data, error } = await supabase
    .from("cash_balances")
    .select("entity, col_key, value, updated_at");
  if (error) throw error;
  return data ?? [];
}

export async function listBankConnections(
  supabase: Sb,
): Promise<BankConnection[]> {
  const { data, error } = await supabase
    .from("bank_connections")
    .select("*")
    .order("institution");
  if (error) {
    // Table may not exist yet in some envs; return empty rather than crash.
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") return [];
    throw error;
  }
  return data ?? [];
}
