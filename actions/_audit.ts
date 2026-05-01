import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

type AuditOp = "INSERT" | "UPDATE" | "DELETE";

/**
 * Append an audit-log row. No-ops if the table doesn't exist yet
 * (Phase E adds it). All write Server Actions should call this on
 * success so the eventual RLS-protected log captures every change.
 */
export async function writeAuditLog(args: {
  actorUserId: string;
  table: string;
  rowId?: string | null;
  op: AuditOp;
  before?: Json | null;
  after?: Json | null;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("audit_log").insert({
    actor_user_id: args.actorUserId,
    table_name: args.table,
    row_id: args.rowId ?? null,
    op: args.op,
    before: args.before ?? null,
    after: args.after ?? null,
  });
  if (error) {
    // 42P01 = table does not exist; tolerate until Phase E migration runs.
    const code = (error as { code?: string }).code;
    if (code === "42P01") return;
    console.error("[audit_log]", error);
  }
}
