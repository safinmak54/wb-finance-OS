"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export type TxnTab =
  | "all"
  | "transfer"
  | "cc_payment"
  | "finalized"
  | "remaining";

type Props = {
  /** Current tab, resolved server-side from `?tab=`. */
  tab: TxnTab;
  /** Which page — the bank tab bar includes "Internal transaction"; the
   *  credit-card one does not. */
  side: "bank" | "cc";
  /** Effective period key (`"all"` or `YYYY-MM`), resolved server-side. */
  periodKey: string;
  /** Month options for the picker (first entry is the "All months" sentinel). */
  months: Array<{ key: string; label: string }>;
  /** Live count of still-pending rows, shown on the Remaining tab. */
  openCount: number;
};

/** Tab bar + month picker for the bank & CC transaction pages. Drives the
 *  server fetch purely through the URL (`?tab=` and `?period=`), preserving
 *  every other search param. */
export function TxnViewControls({
  tab,
  side,
  periodKey,
  months,
  openCount,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function pushWith(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  const tabs: Array<{ key: TxnTab; label: string }> = [
    { key: "all", label: "All" },
    ...(side === "bank"
      ? [{ key: "transfer" as const, label: "Internal transaction" }]
      : []),
    { key: "cc_payment", label: "CC Payment" },
    { key: "finalized", label: "Finalised" },
    { key: "remaining", label: `Remaining (${openCount})` },
  ];

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-md border border-border bg-surface p-0.5">
        {tabs.map((t) => (
          <Tab
            key={t.key}
            label={t.label}
            active={tab === t.key}
            disabled={isPending}
            onClick={() => pushWith({ tab: t.key })}
          />
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs">
        <span className="text-muted">Month:</span>
        <select
          value={periodKey}
          onChange={(e) => pushWith({ period: e.target.value })}
          disabled={isPending}
          className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11px]"
        >
          {months.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Tab({
  label,
  active,
  onClick,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={cn(
        "rounded px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted hover:text-foreground",
        disabled && "opacity-50",
      )}
    >
      {label}
    </button>
  );
}
