"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for the sign-out `<form action={logout}>`. Surfaces the
 * form's pending state via `useFormStatus`, disabling itself and swapping
 * its label while the Server Action runs. Kept as its own client component
 * so the parent page can remain a Server Component.
 */
export function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="h-10 w-full rounded-md border border-border bg-surface text-sm font-medium text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
