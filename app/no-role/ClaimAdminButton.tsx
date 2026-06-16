"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { claimFirstAdmin } from "./actions";

/**
 * Calls the `claimFirstAdmin` Server Action and surfaces both its pending
 * state and any thrown error to the user.
 *
 * The action ends with `redirect()` on success, which throws Next.js'
 * internal redirect signal — `unstable_rethrow` re-throws that so
 * navigation still happens, and only *real* failures (e.g. "Bootstrap
 * already complete", missing service-role key) are shown inline below
 * the button.
 */
export function ClaimAdminButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        await claimFirstAdmin();
      } catch (err) {
        // A successful claim redirects, which surfaces here as Next.js'
        // internal redirect signal — re-throw it so navigation proceeds.
        // `unstable_rethrow` lets only *real* failures fall through.
        unstable_rethrow(err);
        setError(
          err instanceof Error ? err.message : "Failed to claim admin role.",
        );
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-busy={isPending || undefined}
        className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Claiming…" : "Claim admin role"}
      </button>
      {error ? (
        <p role="alert" className="text-center text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}
