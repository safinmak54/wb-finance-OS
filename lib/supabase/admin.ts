import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readServerEnv } from "@/lib/env";

/**
 * Service-role Supabase client. **Bypasses RLS** and should only be used
 * from Server Actions and Route Handlers that have already verified the
 * caller is an admin. Never re-export this in a Client Component.
 *
 * The `import "server-only"` at the top of the file makes Next.js fail
 * the build if any "use client" module ever pulls this in.
 */
let cached: ReturnType<typeof createClient> | null = null;

export function getAdminClient() {
  if (cached) return cached;

  const env = readServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local before using admin features.",
    );
  }

  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
