"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Counts admins across the entire Supabase Auth user pool.
 * Returns null when the service role key is not configured (so callers
 * can fall back to "hide the button" rather than 500ing the page).
 */
export async function countAdmins(): Promise<number | null> {
  let admin;
  try {
    admin = getAdminClient();
  } catch {
    return null;
  }

  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw new Error(error.message);

  return data.users.filter(
    (u) => (u.user_metadata as { role?: unknown } | null)?.role === "admin",
  ).length;
}

/**
 * One-time bootstrap: promote the current user to admin, but **only**
 * when zero admins exist anywhere in the system. After the first admin
 * exists this action will reject every subsequent call.
 *
 * The 0-admin check is done at action-time (not just at render-time) so
 * a stale page rendered before bootstrap cannot replay the action after
 * an admin was provisioned.
 */
export async function claimFirstAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const admin = getAdminClient();

  // Server-side gate: must be zero admins.
  const count = await countAdmins();
  if (count === null) {
    throw new Error(
      "Bootstrap unavailable — SUPABASE_SERVICE_ROLE_KEY is not configured.",
    );
  }
  if (count > 0) {
    throw new Error("Bootstrap already complete.");
  }

  // Preserve any existing metadata (display_name, etc.).
  const { data: existing, error: fetchErr } = await admin.auth.admin.getUserById(
    user.id,
  );
  if (fetchErr) throw new Error(fetchErr.message);

  const nextMetadata = {
    ...(existing.user.user_metadata ?? {}),
    role: "admin",
  };

  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: nextMetadata,
  });
  if (updateErr) throw new Error(updateErr.message);

  revalidatePath("/no-role");
  redirect("/");
}
