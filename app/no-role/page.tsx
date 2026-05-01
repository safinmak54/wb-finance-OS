import { redirect } from "next/navigation";
import { logout } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { claimFirstAdmin, countAdmins } from "./actions";
import { ClaimAdminButton } from "./ClaimAdminButton";

/**
 * Shown when a user is authenticated but has no role assigned.
 * Breaks the otherwise-infinite redirect loop between `/` and `/login`
 * for accounts that exist in Supabase Auth but have not yet been
 * provisioned with `user_metadata.role` (or a `profiles` row).
 *
 * Includes a one-time bootstrap: when zero admins exist anywhere in
 * the system, the current user can promote themselves to admin via the
 * `claimFirstAdmin` Server Action. The button is hidden as soon as one
 * admin exists.
 */
export const dynamic = "force-dynamic";

export default async function NoRolePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Anonymous → kick to login.
  if (!user) redirect("/login");

  // If a role has since been assigned, send them to their landing page.
  const profile = await getCurrentProfile();
  if (profile) redirect("/");

  // `null` means service-role key is missing → we can't tell, so we
  // err on the side of hiding the bootstrap button.
  const adminCount = await countAdmins().catch(() => null);
  const canBootstrap = adminCount === 0;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-card">
        <div className="mb-5 flex flex-col items-center gap-3">
          <div
            className={
              canBootstrap
                ? "grid h-12 w-12 place-items-center rounded-lg bg-primary text-primary-foreground text-lg font-bold"
                : "grid h-12 w-12 place-items-center rounded-lg bg-warning text-white text-lg font-bold"
            }
          >
            {canBootstrap ? "★" : "!"}
          </div>
          <h1 className="text-center text-base font-semibold text-foreground">
            {canBootstrap ? "Set up Finance OS" : "Account not provisioned"}
          </h1>
          <p className="text-center text-xs text-muted">
            {canBootstrap
              ? "No administrator exists yet. Claim the first admin role to finish setup — you can invite the rest of your team from the Users page afterwards."
              : "Your sign-in worked, but no role has been assigned to your account yet. Ask an administrator to grant you access, then sign in again."}
          </p>
        </div>

        <p className="mb-4 text-center text-[11px] text-subtle">
          Signed in as <span className="font-mono">{user.email}</span>
        </p>

        <div className="flex flex-col gap-2">
          {canBootstrap ? (
            <form action={claimFirstAdmin}>
              <ClaimAdminButton />
            </form>
          ) : null}

          <form action={logout}>
            <button
              type="submit"
              className="h-10 w-full rounded-md border border-border bg-surface text-sm font-medium text-foreground transition hover:bg-surface-2"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
