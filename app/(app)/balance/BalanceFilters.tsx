"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Balance-sheet date range: a Start → End picker. Pushes
 * `?period=custom&from=…&to=…` to the URL so the Server Component re-renders
 * the sheet for the new window. Balances are cumulative *through* the End
 * date (point-in-time snapshot); the Start date only scopes the Net Income
 * line — see `app/(app)/balance/page.tsx`.
 */
export function BalanceFilters({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  // Re-sync the inputs when the resolved range changes (e.g. entity switch).
  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);

  function applyRange() {
    if (!draftFrom || !draftTo || draftFrom > draftTo) return;
    const sp = new URLSearchParams(params.toString());
    sp.set("period", "custom");
    sp.set("from", draftFrom);
    sp.set("to", draftTo);
    startTransition(() => router.push(`${pathname}?${sp.toString()}`));
  }

  const dirty = draftFrom !== from || draftTo !== to;
  const valid = Boolean(draftFrom && draftTo && draftFrom <= draftTo);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
        <label
          htmlFor="bs-start"
          className="text-[10px] font-medium uppercase tracking-wider text-muted"
        >
          Start
        </label>
        <input
          id="bs-start"
          type="date"
          value={draftFrom}
          max={draftTo || undefined}
          onChange={(e) => setDraftFrom(e.target.value)}
          aria-label="Start date"
          className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary"
        />
        <span className="text-xs text-muted">→</span>
        <label
          htmlFor="bs-end"
          className="text-[10px] font-medium uppercase tracking-wider text-muted"
        >
          End
        </label>
        <input
          id="bs-end"
          type="date"
          value={draftTo}
          min={draftFrom || undefined}
          onChange={(e) => setDraftTo(e.target.value)}
          aria-label="End date"
          className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary"
        />
        <Button
          type="button"
          size="sm"
          onClick={applyRange}
          loading={pending}
          disabled={!valid || !dirty}
        >
          Apply
        </Button>
      </div>
      <span className="text-[11px] text-muted">
        Balances as of the End date · Net Income covers Start → End
      </span>
    </div>
  );
}
