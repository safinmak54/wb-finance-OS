"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * "Add Transaction" navigation control. Was an <a href="/inbox">; converted
 * to a button so navigation runs through useTransition + router.push and can
 * show pending feedback (dim + disable) instead of a dead click. Destination
 * and styling match the original anchor.
 */
export function AddTransactionButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      aria-busy={isPending || undefined}
      onClick={() => startTransition(() => router.push("/inbox"))}
      className="hidden rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
    >
      {isPending ? "Opening…" : "+ Add Transaction"}
    </button>
  );
}
