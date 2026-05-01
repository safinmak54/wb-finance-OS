"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createDataClient } from "@/lib/supabase/data";
import { requireRole } from "./_authz";
import { writeAuditLog } from "./_audit";

const NOTE_ROLES = ["coo", "cpa", "admin"] as const;

const NoteBase = {
  period: z.string().regex(/^\d{4}-\d{2}$/),
  entity: z.string().trim().max(40).optional(),
  content: z.string().trim().max(20000),
};
const CreateNoteSchema = z.object(NoteBase);
const UpdateNoteSchema = z.object({
  id: z.string().uuid(),
  ...NoteBase,
});

export async function createCfoNote(input: z.input<typeof CreateNoteSchema>) {
  const me = await requireRole(NOTE_ROLES);
  const parsed = CreateNoteSchema.parse(input);

  const supabase = createDataClient();
  const { data, error } = await supabase
    .from("cfo_notes")
    .insert({
      period: parsed.period,
      entity: parsed.entity ?? null,
      content: parsed.content,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "cfo_notes",
    rowId: data?.id,
    op: "INSERT",
    after: parsed,
  });
  revalidatePath("/cfnotes");
  return { id: data?.id };
}

export async function updateCfoNote(input: z.input<typeof UpdateNoteSchema>) {
  const me = await requireRole(NOTE_ROLES);
  const parsed = UpdateNoteSchema.parse(input);

  const supabase = createDataClient();
  const { error } = await supabase
    .from("cfo_notes")
    .update({
      period: parsed.period,
      entity: parsed.entity ?? null,
      content: parsed.content,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "cfo_notes",
    rowId: parsed.id,
    op: "UPDATE",
    after: parsed,
  });
  revalidatePath("/cfnotes");
}

export async function deleteCfoNote(id: string) {
  const me = await requireRole(NOTE_ROLES);
  const supabase = createDataClient();
  const { error } = await supabase.from("cfo_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorUserId: me.userId,
    table: "cfo_notes",
    rowId: id,
    op: "DELETE",
  });
  revalidatePath("/cfnotes");
}
