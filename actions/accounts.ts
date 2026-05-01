"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const ACCOUNT_ROLES = ["bookkeeper", "cpa", "admin"] as const;

const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
] as const;

const AccountBase = {
  account_code: z.string().trim().min(1).max(20),
  account_name: z.string().trim().min(1).max(120),
  account_type: z.enum(ACCOUNT_TYPES),
  account_subtype: z.string().trim().max(40).optional(),
  normal_balance: z.enum(["DEBIT", "CREDIT"]),
  line: z.string().trim().max(80).optional(),
  is_elimination: z.boolean().default(false),
};

const CreateAccountSchema = z.object(AccountBase);
const UpdateAccountSchema = z.object({
  id: z.string().uuid(),
  ...AccountBase,
});

export async function createAccount(
  input: z.input<typeof CreateAccountSchema>,
) {
  const me = await requireRole(ACCOUNT_ROLES);
  const parsed = CreateAccountSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      account_code: parsed.account_code,
      account_name: parsed.account_name,
      account_type: parsed.account_type,
      account_subtype: parsed.account_subtype ?? null,
      normal_balance: parsed.normal_balance,
      line: parsed.line ?? null,
      is_elimination: parsed.is_elimination,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "accounts",
    rowId: data?.id,
    op: "INSERT",
    after: parsed,
  });

  revalidatePath("/coa");
  return { id: data?.id };
}

export async function updateAccount(
  input: z.input<typeof UpdateAccountSchema>,
) {
  const me = await requireRole(ACCOUNT_ROLES);
  const parsed = UpdateAccountSchema.parse(input);

  const supabase = await createClient();
  const { id, ...fields } = parsed;
  const { error } = await supabase
    .from("accounts")
    .update({
      account_code: fields.account_code,
      account_name: fields.account_name,
      account_type: fields.account_type,
      account_subtype: fields.account_subtype ?? null,
      normal_balance: fields.normal_balance,
      line: fields.line ?? null,
      is_elimination: fields.is_elimination,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "accounts",
    rowId: id,
    op: "UPDATE",
    after: fields,
  });

  revalidatePath("/coa");
}

export async function deactivateAccount(id: string) {
  const me = await requireRole(ACCOUNT_ROLES);
  const supabase = await createClient();
  const { error } = await supabase
    .from("accounts")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "accounts",
    rowId: id,
    op: "DELETE",
  });

  revalidatePath("/coa");
}
