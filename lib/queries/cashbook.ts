import type { Sb } from "./_client";
import type { CashbookSnapshot } from "@/lib/supabase/types";

export type CashbookSnapshotPair = {
  paymentMethod: CashbookSnapshot | null;
  salesSummary: CashbookSnapshot | null;
};

/**
 * Latest snapshot per source for a given inclusive date range.
 * Returns nulls when no snapshot has been fetched for that range yet.
 */
export async function getLatestSnapshots(
  supabase: Sb,
  args: { startDate: string; endDate: string },
): Promise<CashbookSnapshotPair> {
  const { data, error } = await supabase
    .from("cashbook_snapshots")
    .select("id, period_start, period_end, source, payload, fetched_at, fetched_by")
    .eq("period_start", args.startDate)
    .eq("period_end", args.endDate)
    .order("fetched_at", { ascending: false });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") {
      return { paymentMethod: null, salesSummary: null };
    }
    throw error;
  }

  const rows = (data ?? []) as CashbookSnapshot[];
  return {
    paymentMethod: rows.find((r) => r.source === "payment_method") ?? null,
    salesSummary: rows.find((r) => r.source === "sales_summary") ?? null,
  };
}
