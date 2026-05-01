"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that surfaces the parent `<form>`'s pending state via
 * `useFormStatus`. The form itself stays a Server Component-rendered
 * `<form action={claimFirstAdmin}>`, which is the supported way to call
 * a Server Action that ends with `redirect()` — Next.js handles the
 * redirect transparently.
 */
export function ClaimAdminButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Claiming…" : "Claim admin role"}
    </button>
  );
}
