import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Server-side data client — anon key, no auth context.
 *
 * Authorization is enforced in the app layer (middleware + `<RoleGate>` +
 * `requireRole` in Server Actions), not by Supabase RLS bound to the user's
 * JWT. By dropping the per-request cookie context we always evaluate as the
 * `anon` role, which keeps RLS policies simple (they only need to grant
 * SELECT/INSERT/UPDATE/DELETE to anon).
 *
 * Use this everywhere except the auth flow (`auth.getUser`, sign-in,
 * sign-out) — those still need the cookie-bound `createClient` from
 * `./server.ts` so that the session lives in the response cookie.
 */
export function createDataClient() {
  return createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
