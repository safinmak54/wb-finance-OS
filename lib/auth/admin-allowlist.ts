import "server-only";

/**
 * Reads the `ADMIN_EMAILS` env var: a comma-separated list of email
 * addresses that should be treated as admin even when their Supabase
 * `user_metadata.role` is not set.
 *
 * Use cases:
 *   1. Bootstrap a fresh deployment without touching Supabase Dashboard
 *      or having the service role key available.
 *   2. Provide a "break glass" admin path independent of the database
 *      (e.g., recovery if user_metadata gets corrupted).
 *
 * Listed emails always read as admin — they cannot be demoted via the
 * Users page. To revoke, remove the address from the env var.
 */
export function getAdminAllowlist(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailInAdminAllowlist(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminAllowlist().includes(email.toLowerCase());
}
