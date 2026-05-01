import type { Sb } from "./_client";
import type { Entity } from "@/lib/supabase/types";

export async function listEntities(supabase: Sb): Promise<Entity[]> {
  const { data, error } = await supabase
    .from("entities")
    .select("*")
    .order("code");
  if (error) throw error;
  return data ?? [];
}

/** Code → id map; useful when filtering tables that key on `entity_id`. */
export async function entityCodeToId(
  supabase: Sb,
): Promise<Record<string, string>> {
  const rows = await listEntities(supabase);
  const map: Record<string, string> = {};
  for (const e of rows) map[e.code] = e.id;
  return map;
}
