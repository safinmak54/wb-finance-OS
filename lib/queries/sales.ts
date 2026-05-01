import type { Sb } from "./_client";
import { applyEntityCodeFilter } from "@/lib/entity-filter";
import type { EntityFilterValue } from "@/lib/entities";

type SalesTxn = {
  amount: number;
  acc_date: string;
  accounts: { account_type: string; account_subtype: string | null } | null;
};

/**
 * Pull revenue transactions for a period+entity. Used by the Sales,
 * Product Mix, and Dashboard pages.
 */
export async function listRevenue(
  supabase: Sb,
  args: { entity: EntityFilterValue; from: string; to: string },
): Promise<SalesTxn[]> {
  let q = supabase
    .from("transactions")
    .select("amount, acc_date, accounts(account_type, account_subtype)")
    .gte("acc_date", args.from)
    .lte("acc_date", args.to);

  if (args.entity && args.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", args.entity);
  }

  const { data, error } = await q.returns<SalesTxn[]>();
  if (error) throw error;
  return (data ?? []).filter((t) => t.accounts?.account_type === "revenue");
}

export type SalesByDay = Array<{ day: string; revenue: number }>;

export function bucketByDay(txns: readonly SalesTxn[]): SalesByDay {
  const map = new Map<string, number>();
  for (const t of txns) {
    map.set(t.acc_date, (map.get(t.acc_date) ?? 0) + Number(t.amount ?? 0));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, revenue]) => ({ day, revenue }));
}
