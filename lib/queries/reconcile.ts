import type { Sb } from "./_client";
import type { ReconciliationMatch } from "@/lib/supabase/types";

export async function listReconciliationMatches(
  supabase: Sb,
): Promise<ReconciliationMatch[]> {
  const { data, error } = await supabase
    .from("reconciliation_matches")
    .select("id, statement_txn_id, book_txn_id, match_status, amount");
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") return [];
    throw error;
  }
  return data ?? [];
}
