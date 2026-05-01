import "server-only";
import { getCurrentProfile, type UserProfile } from "@/lib/auth/profile";
import type { Role } from "@/lib/auth/permissions";

/**
 * Require the caller to have one of the allowed roles. Throws on denial
 * — Server Action callers should let the throw propagate to the
 * client, which will see a 500. (We do not leak details about the
 * actual user; "Forbidden" is enough.)
 */
export async function requireRole(
  allowed: readonly Role[],
): Promise<UserProfile> {
  const me = await getCurrentProfile();
  if (!me || !allowed.includes(me.role)) {
    throw new Error("Forbidden");
  }
  return me;
}
