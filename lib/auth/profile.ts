import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/auth/permissions";
import { isEmailInAdminAllowlist } from "@/lib/auth/admin-allowlist";

export type UserProfile = {
  userId: string;
  email: string;
  role: Role;
  displayName: string | null;
};

/**
 * Returns the current user's profile, or null if unauthenticated.
 * Memoized per request via `cache` so repeated calls in a single render
 * do not hit Supabase multiple times.
 *
 * Resolution order (first match wins):
 *   1. `ADMIN_EMAILS` env-var allowlist — the configured email is always
 *      admin, no DB lookup needed. Useful for bootstrap and recovery.
 *   2. The `profiles` table (`user_id` → `role`, `display_name`).
 *   3. `auth.users.user_metadata.role` — set when an admin invites a
 *      user via the Users page or Supabase Dashboard.
 */
export const getCurrentProfile = cache(
  async (): Promise<UserProfile | null> => {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, display_name")
      .eq("user_id", user.id)
      .returns<Array<{ role: string | null; display_name: string | null }>>()
      .maybeSingle();

    const metadataRole = (user.user_metadata as { role?: unknown })?.role;

    let role: Role | null = profile && isRole(profile.role)
      ? profile.role
      : isRole(metadataRole)
        ? metadataRole
        : null;

    // Env-var allowlist trumps everything: a listed email is always admin.
    if (isEmailInAdminAllowlist(user.email)) {
      role = "admin";
    }

    if (!role) return null;

    return {
      userId: user.id,
      email: user.email ?? "",
      role,
      displayName: profile?.display_name ?? null,
    };
  },
);
