import type { Sb } from "./_client";
import type { CfoNote } from "@/lib/supabase/types";

export async function listCfoNotes(supabase: Sb): Promise<CfoNote[]> {
  const { data, error } = await supabase
    .from("cfo_notes")
    .select("*")
    .order("period", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
  return data ?? [];
}
