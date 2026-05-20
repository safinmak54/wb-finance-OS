import type { Sb } from "./_client";
import type { ApItemView } from "@/lib/supabase/types";
import type { EntityFilterValue } from "@/lib/entities";
import { applyEntityCodeFilter } from "@/lib/entity-filter";

/** Open AP items (paid=false), ordered by due_date. */
export async function listOpenApItems(
  supabase: Sb,
  opts: { entity?: EntityFilterValue } = {},
): Promise<ApItemView[]> {
  let q = supabase
    .from("ap_items")
    .select(
      "id, vendor, entity, invoice_date, due_date, amount, paid, dispute_note",
    )
    .eq("paid", false)
    .order("due_date", { ascending: true });

  if (opts.entity && opts.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", opts.entity);
  }

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    entity: row.entity,
    due_date: row.due_date,
    amount: Number(row.amount),
    paid: row.paid,
    invoice_date: row.invoice_date,
    vendor_name: row.vendor,
    dispute_note: row.dispute_note,
  }));
}
