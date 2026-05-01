"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const INVOICE_ROLES = ["coo", "bookkeeper", "admin"] as const;

const CreateInvoiceSchema = z.object({
  vendor_id: z.string().uuid(),
  invoice_number: z.string().trim().min(1).max(60),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().nonnegative(),
  status: z.enum(["open", "partial", "paid", "overdue"]).default("open"),
});

const PayInvoiceSchema = z.object({
  id: z.string().uuid(),
  amount_paid: z.number().nonnegative(),
});

export async function createInvoice(
  input: z.input<typeof CreateInvoiceSchema>,
) {
  const me = await requireRole(INVOICE_ROLES);
  const parsed = CreateInvoiceSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      vendor_id: parsed.vendor_id,
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date,
      due_date: parsed.due_date,
      amount: parsed.amount,
      amount_paid: 0,
      status: parsed.status,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "invoices",
    rowId: data?.id,
    op: "INSERT",
    after: parsed,
  });

  revalidatePath("/invoices");
  revalidatePath("/ap");
  return { id: data?.id };
}

export async function recordPayment(input: z.input<typeof PayInvoiceSchema>) {
  const me = await requireRole(INVOICE_ROLES);
  const parsed = PayInvoiceSchema.parse(input);

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("invoices")
    .select("amount, amount_paid")
    .eq("id", parsed.id)
    .single();
  if (!existing) throw new Error("Invoice not found");

  const total = Number(existing.amount ?? 0);
  const newPaid = Number(existing.amount_paid ?? 0) + parsed.amount_paid;
  const status =
    newPaid >= total ? "paid" : newPaid > 0 ? "partial" : "open";

  const { error } = await supabase
    .from("invoices")
    .update({ amount_paid: newPaid, status })
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "invoices",
    rowId: parsed.id,
    op: "UPDATE",
    before: { amount_paid: existing.amount_paid },
    after: { amount_paid: newPaid, status },
  });

  revalidatePath("/invoices");
  revalidatePath("/ap");
}

export async function deleteInvoice(id: string) {
  const me = await requireRole(INVOICE_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "invoices",
    rowId: id,
    op: "DELETE",
  });

  revalidatePath("/invoices");
  revalidatePath("/ap");
}
