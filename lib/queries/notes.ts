import type { Sb } from "./_client";
import type { CfoNote } from "@/lib/supabase/types";

export async function listCfoNotes(supabase: Sb): Promise<CfoNote[]> {
  const { data, error } = await supabase
    .from("cfo_notes")
    .select("*")
    .order("period", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") return [];
    throw error;
  }
  return data ?? [];
}
