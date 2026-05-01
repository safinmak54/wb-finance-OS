import type { Sb } from "./_client";
import type { ApItem } from "@/lib/supabase/types";
import type { EntityFilterValue } from "@/lib/entities";
import { applyEntityCodeFilter } from "@/lib/entity-filter";

/**
 * Open AP items (paid=false), ordered by due_date.
 * Mirrors `app.renderAP()` from legacy/app.js (~line 7075).
 */
export async function listOpenApItems(
  supabase: Sb,
  opts: { entity?: EntityFilterValue } = {},
): Promise<ApItem[]> {
  let q = supabase
    .from("ap_items")
    .select("*")
    .eq("paid", false)
    .order("due_date", { ascending: true });

  if (opts.entity && opts.entity !== "all") {
    q = applyEntityCodeFilter(q, "entity", opts.entity);
  }

  const { data, error } = await q.returns<ApItem[]>();
  if (error) throw error;
  return data ?? [];
}
