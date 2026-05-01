"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const VENDOR_ROLES = ["coo", "bookkeeper", "admin"] as const;

const VendorBase = {
  name: z.string().trim().min(1).max(120),
  status: z.string().trim().max(20).optional(),
};

const CreateVendorSchema = z.object(VendorBase);
const UpdateVendorSchema = z.object({
  id: z.string().uuid(),
  ...VendorBase,
});

export async function createVendor(input: z.input<typeof CreateVendorSchema>) {
  const me = await requireRole(VENDOR_ROLES);
  const parsed = CreateVendorSchema.parse(input);

  const supabase = createDataClient();
  const { data, error } = await supabase
    .from("vendors")
    .insert({
      name: parsed.name,
      status: parsed.status ?? "active",
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "vendors",
    rowId: data?.id,
    op: "INSERT",
    after: parsed,
  });

  revalidatePath("/vendors");
  return { id: data?.id };
}

export async function updateVendor(input: z.input<typeof UpdateVendorSchema>) {
  const me = await requireRole(VENDOR_ROLES);
  const parsed = UpdateVendorSchema.parse(input);
  const { id, ...fields } = parsed;

  const supabase = createDataClient();
  const { error } = await supabase
    .from("vendors")
    .update({
      name: fields.name,
      status: fields.status ?? "active",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "vendors",
    rowId: id,
    op: "UPDATE",
    after: fields,
  });

  revalidatePath("/vendors");
}

export async function deleteVendor(id: string) {
  const me = await requireRole(VENDOR_ROLES);
  const supabase = createDataClient();
  const { error } = await supabase
    .from("vendors")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "vendors",
    rowId: id,
    op: "DELETE",
  });

  revalidatePath("/vendors");
}
