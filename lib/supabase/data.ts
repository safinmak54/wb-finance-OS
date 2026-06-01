import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readServerEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Server-side data client — service-role key, no auth context.
 *
 * Authorization is enforced in the app layer (middleware + `<RoleGate>` +
 * `requireRole` in Server Actions), NOT by Supabase RLS bound to the user's
 * JWT. The deployed RLS policies (migrations/0002_enable_rls.sql) gate every
 * table on `auth.uid()` / the caller's role, but this client carries no
 * cookie/session — so connecting with the anon key would evaluate every
 * request as the `anon` role (auth.uid() = NULL) and RLS would reject all
 * reads and writes. We therefore use the service-role key, which bypasses
 * RLS; the `requireRole(...)` gate in each Server Action is what actually
 * authorizes the caller.
 *
 * `import "server-only"` ensures this never reaches a Client Component, so
 * the service-role key stays on the server.
 *
 * Use this everywhere except the auth flow (`auth.getUser`, sign-in,
 * sign-out) — those still need the cookie-bound `createClient` from
 * `./server.ts` so that the session lives in the response cookie.
 */
export function createDataClient() {
  const env = readServerEnv();
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
