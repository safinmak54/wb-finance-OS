"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const BANK_ROLES = ["coo", "admin"] as const;

const BankBase = {
  institution: z.string().trim().min(1).max(80),
  entity: z.string().trim().max(40).optional(),
  account_number: z.string().trim().max(40).optional(),
  current_balance: z.number().optional(),
  status: z.string().trim().max(20).optional(),
};

const CreateBankSchema = z.object(BankBase);
const UpdateBankSchema = z.object({
  id: z.string().uuid(),
  ...BankBase,
});

export async function createBankConnection(
  input: z.input<typeof CreateBankSchema>,
) {
  const me = await requireRole(BANK_ROLES);
  const parsed = CreateBankSchema.parse(input);

  const supabase = createDataClient();
  const { data, error } = await supabase
    .from("bank_connections")
    .insert({
      institution: parsed.institution,
      entity: parsed.entity ?? null,
      account_number: parsed.account_number ?? null,
      current_balance: parsed.current_balance ?? null,
      status: parsed.status ?? "connected",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "bank_connections",
    rowId: data?.id,
    op: "INSERT",
    after: parsed,
  });
  revalidatePath("/banks");
  return { id: data?.id };
}

export async function updateBankConnection(
  input: z.input<typeof UpdateBankSchema>,
) {
  const me = await requireRole(BANK_ROLES);
  const parsed = UpdateBankSchema.parse(input);

  const supabase = createDataClient();
  const { id, ...fields } = parsed;
  const { error } = await supabase
    .from("bank_connections")
    .update({
      institution: fields.institution,
      entity: fields.entity ?? null,
      account_number: fields.account_number ?? null,
      current_balance: fields.current_balance ?? null,
      status: fields.status ?? "connected",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "bank_connections",
    rowId: id,
    op: "UPDATE",
    after: fields,
  });
  revalidatePath("/banks");
}

export async function deleteBankConnection(id: string) {
  const me = await requireRole(BANK_ROLES);
  const supabase = createDataClient();
  const { error } = await supabase
    .from("bank_connections")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "bank_connections",
    rowId: id,
    op: "DELETE",
  });
  revalidatePath("/banks");
}
