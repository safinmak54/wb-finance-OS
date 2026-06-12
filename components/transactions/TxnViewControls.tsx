"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils/cn";

export type TxnView = "open" | "finalized";

type Props = {
  /** Current view, resolved server-side from `?view=`. */
  view: TxnView;
  /** Effective period key (`"all"` or `YYYY-MM`), resolved server-side. */
  periodKey: string;
  /** Month options for the picker (first entry is the "All months" sentinel). */
  months: Array<{ key: string; label: string }>;
  /** Live count of still-pending rows, shown on the To-classify tab. */
  openCount: number;
};

/** Tab toggle (To classify / Finalized) + month picker for the bank & CC
 *  transaction pages. Drives the server fetch purely through the URL
 *  (`?view=` and `?period=`), preserving every other search param. */
export function TxnViewControls({ view, periodKey, months, openCount }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushWith(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-border bg-surface p-0.5">
        <Tab
          label={`To classify (${openCount})`}
          active={view === "open"}
          // Drop the period param so the open tab defaults back to "All months".
          onClick={() => pushWith({ view: null, period: null })}
        />
        <Tab
          label="Finalized"
          active={view === "finalized"}
          onClick={() => pushWith({ view: "finalized" })}
        />
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs">
        <span className="text-muted">Month:</span>
        <select
          value={periodKey}
          // Always set an explicit value — including "all". The Finalized tab
          // defaults to the current month when `period` is absent, so dropping
          // the param would silently re-narrow to this month instead of "all".
          onChange={(e) => pushWith({ period: e.target.value })}
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
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
