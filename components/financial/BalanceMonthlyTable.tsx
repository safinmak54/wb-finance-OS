import { Fragment } from "react";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

export type BalanceMonthlyRow =
  | { kind: "section"; label: string }
  | {
      kind: "account";
      label: string;
      // Pre-sign-flipped values per month key.
      values: Record<string, number>;
    }
  | {
      kind: "total";
      label: string;
      values: Record<string, number>;
      emphasis?: "primary" | "highlight";
    };

function pct(value: number, denom: number): string {
  if (!denom || denom === 0) return "—";
  const p = (value / denom) * 100;
  if (!isFinite(p)) return "—";
  return `${p >= 0 ? "" : "-"}${Math.abs(p).toFixed(0)}%`;
}

export function BalanceMonthlyTable({
  months,
  rows,
  denomByMonth,
}: {
  months: ReadonlyArray<{ key: string; label: string }>;
  rows: BalanceMonthlyRow[];
  /** Per-month denominator for % column (typically total assets). */
  denomByMonth: Record<string, number>;
}) {
  const colTemplate = months
    .map(() => "minmax(80px, 1fr) minmax(38px, 0.45fr)")
    .join(" ");
  const gridCols = `minmax(220px, 1.6fr) ${colTemplate}`;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
      <div className="min-w-fit">
        <div
          className="grid items-end gap-x-1.5 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div>Account</div>
          {months.map((m) => (
            <Fragment key={m.key}>
              <div className="text-right">{m.label}</div>
              <div
                className="text-right text-[10px] normal-case tracking-normal text-muted/70"
                title="% of total assets"
              >
                % a.
              </div>
            </Fragment>
          ))}
        </div>

        {rows.map((row, i) => {
          if (row.kind === "section") {
            return (
              <div
                key={`s-${i}-${row.label}`}
                className="grid items-center gap-x-1.5 border-t border-border bg-surface-2 px-3 py-0.5 text-[12px] font-semibold uppercase tracking-wider"
                style={{ gridTemplateColumns: gridCols }}
              >
                <div>{row.label}</div>
              </div>
            );
          }

          if (row.kind === "account") {
            return (
              <div
                key={`a-${i}-${row.label}`}
                className="grid items-center gap-x-1.5 border-t border-border px-3 py-0.5 text-xs hover:bg-surface-2/40"
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className="pl-4 text-muted">{row.label}</div>
                {months.map((m) => {
                  const v = row.values[m.key] ?? 0;
                  const denom = denomByMonth[m.key] ?? 0;
                  return (
                    <Fragment key={m.key}>
                      <div
                        className={cn(
                          "text-right font-mono",
                          v < 0 ? "text-danger" : "text-foreground",
                          v === 0 && "text-muted/60",
                        )}
                      >
                        {fmt(v)}
                      </div>
                      <div className="text-right font-mono text-[10px] text-muted">
                        {pct(v, denom)}
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            );
          }

          return (
            <div
              key={`t-${i}-${row.label}`}
              className={cn(
                "grid items-center gap-x-1.5 border-t border-border px-3 py-0.5 text-xs font-semibold",
                row.emphasis === "primary" && "bg-surface-2",
                row.emphasis === "highlight" && "bg-info-soft/30",
              )}
              style={{ gridTemplateColumns: gridCols }}
            >
              <div className="uppercase tracking-wider">{row.label}</div>
              {months.map((m) => {
                const v = row.values[m.key] ?? 0;
                const denom = denomByMonth[m.key] ?? 0;
                return (
                  <Fragment key={m.key}>
                    <div
                      className={cn(
                        "text-right font-mono text-[13px]",
                        v < 0 ? "text-danger" : "text-foreground",
                        v === 0 && "text-muted/60",
                      )}
                    >
                      {fmt(v)}
                    </div>
                    <div className="text-right font-mono text-[10px] text-muted">
                      {pct(v, denom)}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
