import { PageShell } from "@/components/shell/PageShell";
import { listUsers } from "./actions";
import { UsersTable } from "./UsersTable";
import { CreateUserButton } from "./CreateUserDialog";
import { getCurrentProfile } from "@/lib/auth/profile";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const [profile, users] = await Promise.all([
    getCurrentProfile(),
    listUsers().catch((err) => {
      // We surface the error in the UI rather than 500 the page,
      // because the most common cause is a missing service role key.
      console.error(err);
      return null;
    }),
  ]);

  return (
    <PageShell page="admin-users" title="Users" subtitle="Invite and manage who can access Finance OS">
      {users === null ? (
        <ConfigurationError />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              {users.length} {users.length === 1 ? "user" : "users"}
            </p>
            <CreateUserButton />
          </div>
          <UsersTable users={users} currentUserId={profile?.userId ?? null} />
        </div>
      )}
    </PageShell>
  );
}

function ConfigurationError() {
  return (
    <div className="rounded-xl border border-warning bg-warning-soft p-6">
      <h2 className="text-sm font-semibold text-foreground">
        Service role key not configured
      </h2>
      <p className="mt-2 text-xs text-muted">
        The Users page uses Supabase&apos;s admin API, which requires the
        <code className="mx-1 rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          SUPABASE_SERVICE_ROLE_KEY
        </code>
        environment variable. Add it to{" "}
        <code className="mx-1 rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          .env.local
        </code>{" "}
        and restart the dev server.
      </p>
    </div>
  );
}
