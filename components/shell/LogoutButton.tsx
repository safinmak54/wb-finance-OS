"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for the logout server-action form. Rendered INSIDE the
 * <form action={logout}> so `useFormStatus` can report the form's pending
 * state — disables and swaps to a spinner while signing out, preventing a
 * double-submit.
 */
export function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      title={pending ? "Signing out…" : "Sign out"}
      className="grid h-8 w-8 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <svg
          className="size-4 shrink-0 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z"
          />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      )}
    </button>
  );
}
