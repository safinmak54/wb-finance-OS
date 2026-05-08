import type { Sb } from "./_client";
import type { Vendor } from "@/lib/supabase/types";

export async function listVendors(supabase: Sb): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getVendor(
  supabase: Sb,
  id: string,
): Promise<Vendor | null> {
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function listTopVendorsByYtdSpend(
  supabase: Sb,
  limit = 3,
): Promise<Array<Pick<Vendor, "name" | "ytd_spend">>> {
  const { data, error } = await supabase
    .from("vendors")
    .select("name, ytd_spend")
    .order("ytd_spend", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
