import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Server-side Supabase client bound to the request's cookies.
 * Use in Server Components, Route Handlers, and Server Actions.
 *
 * Auth state is read from cookies; writes go back through `cookies().set`
 * so that refreshed tokens propagate to the browser on the same response.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll is called from Server Components which are read-only;
            // middleware handles refresh in those cases.
          }
        },
      },
    },
  );
}
