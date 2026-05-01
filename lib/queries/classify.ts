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
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
  return data ?? [];
}
