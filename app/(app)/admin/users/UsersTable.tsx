"use client";

import { useState, useTransition } from "react";
import { ROLES, type Role } from "@/lib/auth/permissions";
import type { AdminUser } from "./actions";
import { deleteUser, updateUserRole } from "./actions";
import { cn } from "@/lib/utils/cn";

const ROLE_LABEL: Record<Role, string> = {
  coo: "COO",
  bookkeeper: "Bookkeeper",
  cpa: "CPA",
  admin: "Admin",
};

type Props = {
  users: AdminUser[];
  currentUserId: string | null;
};

export function UsersTable({ users, currentUserId }: Props) {
  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-xs text-muted">
        No users yet. Click &ldquo;Add user&rdquo; to invite the first one.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Display name</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Last sign-in</th>
            <th className="px-4 py-3" aria-label="Actions" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {users.map((u) => (
            <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(user.role);

  function onRoleChange(next: Role) {
    if (next === role) return;
    const previous = role;
    setRole(next);
    setError(null);
    startTransition(async () => {
      try {
        await updateUserRole({ userId: user.id, role: next });
      } catch (err) {
        setRole(previous);
        setError(err instanceof Error ? err.message : "Failed to update role");
      }
    });
  }

  function onDelete() {
    if (isSelf) return;
    if (!confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteUser(user.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete user");
      }
    });
  }

  return (
    <tr className={cn(pending && "opacity-60")}>
      <td className="px-4 py-3 align-middle">
        <div className="flex items-center gap-2">
          <span className="text-foreground">{user.email}</span>
          {isSelf ? (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary">
              You
            </span>
          ) : null}
          {user.banned ? (
            <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-medium text-danger">
              Disabled
            </span>
          ) : null}
        </div>
        {error ? (
          <p className="mt-1 text-[11px] text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-3 align-middle text-muted">
        {user.displayName ?? "—"}
      </td>
      <td className="px-4 py-3 align-middle">
        <select
          value={role ?? ""}
          onChange={(e) => onRoleChange(e.target.value as Role)}
          disabled={pending || (isSelf && role === "admin")}
          aria-label={`Role for ${user.email}`}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {role === null ? <option value="">— None —</option> : null}
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 align-middle text-muted">
        {user.lastSignInAt
          ? new Date(user.lastSignInAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "Never"}
      </td>
      <td className="px-4 py-3 text-right align-middle">
        <button
          type="button"
          onClick={onDelete}
          disabled={pending || isSelf}
          title={isSelf ? "You can't delete yourself" : "Delete user"}
          className="rounded-md px-2 py-1 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
