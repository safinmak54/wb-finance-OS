"use client";

import { cn } from "@/lib/utils/cn";
import { useTxnQuery } from "./useTxnQuery";
import {
  STATUS_OPTIONS,
  kindOptionsFor,
  type TxnKindFilter,
  type TxnStatus,
} from "./txn-tabs";

type Props = {
  /** Active status chip, or null when that row isn't narrowing. */
  status: TxnStatus | null;
  /** Active set-aside chip, or null when that row isn't narrowing. */
  kind: TxnKindFilter | null;
  /** Row counts per chip, already intersected with the active card and the
   *  other row's chip, so a 0 is visible before clicking. */
  statusCounts: Record<TxnStatus, number>;
  kindCounts: Record<TxnKindFilter, number>;
  side: "bank" | "cc";
  /** Effective period key (`"all"` or `YYYY-MM`), resolved server-side. */
  periodKey: string;
  /** Month options for the picker (first entry is the "All months" sentinel). */
  months: Array<{ key: string; label: string }>;
};

/** The two filter rows between the funnel cards and the table:
 *
 *    Row 1   To Classify | Finalized                        Month: [ ▾ ]
 *    Row 2   All Set Aside | Internal Transfers | CC Payment
 *
 *  The rows are independent and compose — pick one from each to see, say,
 *  finalized internal transfers. Clicking an active chip clears that row. */
export function TxnRowFilters({
  status,
  kind,
  statusCounts,
  kindCounts,
  side,
  periodKey,
  months,
}: Props) {
  const { pushWith, isPending } = useTxnQuery();

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ChipRow
          label="Status"
          options={STATUS_OPTIONS}
          active={status}
          counts={statusCounts}
          disabled={isPending}
          onPick={(key) => pushWith({ status: key })}
        />

        <div className="ml-auto flex items-center gap-2 text-xs">
          <label className="text-muted" htmlFor="txn-month">
            Month:
          </label>
          <select
            id="txn-month"
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

      <div className="flex flex-wrap items-center gap-2">
        <ChipRow
          label="Set aside"
          options={kindOptionsFor(side)}
          active={kind}
          counts={kindCounts}
          disabled={isPending}
          onPick={(key) => pushWith({ kind: key })}
        />
      </div>
    </div>
  );
}

function ChipRow<K extends string>({
  label,
  options,
  active,
  counts,
  disabled,
  onPick,
}: {
  label: string;
  options: ReadonlyArray<{ key: K; label: string }>;
  active: K | null;
  counts: Record<K, number>;
  disabled: boolean;
  /** `null` when the active chip is clicked again — clears the row. */
  onPick: (key: K | null) => void;
}) {
  return (
    <>
      <span className="w-[68px] shrink-0 text-[11px] font-medium uppercase tracking-wider text-subtle">
        {label}
      </span>
      <div className="inline-flex flex-wrap rounded-md border border-border bg-surface p-0.5 shadow-card">
        {options.map((o) => {
          const isActive = active === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onPick(isActive ? null : o.key)}
              disabled={disabled}
              aria-pressed={isActive}
              title={isActive ? "Click again to clear this filter" : undefined}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:text-foreground",
                disabled && "opacity-50",
              )}
            >
              {o.label}
              <span
                className={cn(
                  "ml-1.5 font-mono tabular-nums",
                  isActive ? "opacity-80" : "text-subtle",
                )}
              >
                {counts[o.key].toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
