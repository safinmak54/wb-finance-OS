import type { Sb } from "./_client";
import type { ClassificationRule } from "@/lib/supabase/types";

export async function listClassificationRules(
  supabase: Sb,
): Promise<ClassificationRule[]> {
  const { data, error } = await supabase
    .from("classification_rules")
    .select("*")
    .eq("is_active", true)
    .order("created_at");
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") return [];
    throw error;
  }
  return data ?? [];
}
