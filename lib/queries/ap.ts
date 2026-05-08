import type { Sb } from "./_client";
import type { ApItemView } from "@/lib/supabase/types";
import type { EntityFilterValue } from "@/lib/entities";
import { applyEntityCodeFilter } from "@/lib/entity-filter";

/**
 * Open AP items (status != 'paid'), ordered by due_date.
 * Joins vendors and invoices so the table can display vendor name and
 * the original invoice date.
 */
export async function listOpenApItems(
  supabase: Sb,
  opts: { entity?: EntityFilterValue } = {},
): Promise<ApItemView[]> {
  let q = supabase
    .from("ap_items")
    .select(
      "id, vendor_id, invoice_id, entity, due_date, amount, status, description, created_at, vendors(name), invoices(invoice_date)",
    )
    .neq("status", "paid")
    .order("due_date", { ascending: true });

  if (opts.entity && opts.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", opts.entity);
  }

  const { data, error } = await q;
  if (error) throw error;

  type Row = {
    id: string;
    vendor_id: string | null;
    invoice_id: string | null;
    entity: string | null;
    due_date: string;
    amount: number | string;
    status: string;
    description: string | null;
    created_at: string | null;
    vendors: { name: string | null } | { name: string | null }[] | null;
    invoices:
      | { invoice_date: string | null }
      | { invoice_date: string | null }[]
      | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => {
    const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors;
    const invoice = Array.isArray(row.invoices) ? row.invoices[0] : row.invoices;
    return {
      id: row.id,
      vendor_id: row.vendor_id,
      invoice_id: row.invoice_id,
      entity: row.entity,
      due_date: row.due_date,
      amount: Number(row.amount),
      status: row.status,
      description: row.description,
      created_at: row.created_at,
      vendor_name: vendor?.name ?? null,
      invoice_date: invoice?.invoice_date ?? null,
    };
  });
}
