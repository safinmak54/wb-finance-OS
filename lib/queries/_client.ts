import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/** All query helpers accept a server-side Supabase client typed against
 *  our Database. Pass the result of `await createClient()`. */
export type Sb = SupabaseClient<Database>;
