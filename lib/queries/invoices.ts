import type { Sb } from "./_client";
import type { Invoice } from "@/lib/supabase/types";

export type InvoiceWithVendor = Invoice & {
  vendors: { id: string; name: string } | null;
};

export async function listInvoices(supabase: Sb): Promise<InvoiceWithVendor[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, vendors(id, name)")
    .order("due_date", { ascending: true })
    .returns<InvoiceWithVendor[]>();
  if (error) throw error;
  return data ?? [];
}

/** Open + partial + overdue invoices. Used by AP page and dashboards. */
export async function listOpenInvoices(
  supabase: Sb,
): Promise<InvoiceWithVendor[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, vendors(id, name)")
    .in("status", ["open", "partial", "overdue"])
    .order("due_date", { ascending: true })
    .returns<InvoiceWithVendor[]>();
  if (error) throw error;
  return data ?? [];
}
