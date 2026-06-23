"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

const PRESETS: Array<{ value: string; label: string }> = [
  { value: "month", label: "This Month" },
  { value: "last-month", label: "Last Month" },
  { value: "qtd", label: "QTD" },
  { value: "ytd", label: "YTD" },
];

type Props = {
  /** Active period key resolved server-side, so the bar reflects the URL. */
  activeKey: string;
  /** Resolved range for the active period — prefills the custom inputs. */
  from: string;
  to: string;
};

/**
 * Dashboard date filter: preset windows plus a custom From → To range.
 * Pushes `?period=…` (and `?from`/`?to` for custom) to the URL so the
 * Server Component re-renders the KPIs and charts for the new window.
 */
export function DashboardFilters({ activeKey, from, to }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const isCustom = activeKey === "custom";
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  // Re-sync the custom inputs when a preset changes the resolved range.
  useEffect(() => {
    setDraftFrom(from);
    setDraftTo(to);
  }, [from, to]);

  function pushPreset(value: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set("period", value);
    sp.delete("from");
    sp.delete("to");
    startTransition(() => router.push(`${pathname}?${sp.toString()}`));
  }

  function applyCustom() {
    if (!draftFrom || !draftTo || draftFrom > draftTo) return;
    const sp = new URLSearchParams(params.toString());
    sp.set("period", "custom");
    sp.set("from", draftFrom);
    sp.set("to", draftTo);
    startTransition(() => router.push(`${pathname}?${sp.toString()}`));
  }

  const customDirty = draftFrom !== from || draftTo !== to;
  const customValid = Boolean(draftFrom && draftTo && draftFrom <= draftTo);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className={cn(
          "inline-flex overflow-hidden rounded-md border border-border text-xs",
          pending && "opacity-50",
        )}
      >
        {PRESETS.map((p, i) => (
          <button
            key={p.value}
            type="button"
            disabled={pending}
            onClick={() => pushPreset(p.value)}
            className={cn(
              "px-3 py-1.5 font-medium transition",
              i > 0 && "border-l border-border",
              activeKey === p.value
                ? "bg-info-soft text-info"
                : "text-muted hover:bg-surface-2",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2 py-1",
          isCustom ? "border-info bg-info-soft" : "border-border",
        )}
      >
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
          Custom
        </span>
        <input
          type="date"
          value={draftFrom}
          max={draftTo || undefined}
          onChange={(e) => setDraftFrom(e.target.value)}
          aria-label="From date"
          className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary"
        />
        <span className="text-xs text-muted">→</span>
        <input
          type="date"
          value={draftTo}
          min={draftFrom || undefined}
          onChange={(e) => setDraftTo(e.target.value)}
          aria-label="To date"
          className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary"
        />
        <Button
          type="button"
          size="sm"
          onClick={applyCustom}
          loading={pending}
          disabled={!customValid || (isCustom && !customDirty)}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
