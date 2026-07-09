"use client";

import { useEffect, useMemo, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { fmt, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { MonthlyPnlMetrics } from "@/lib/pnl/structure";

export type MetricId =
  | "grossRevenue"
  | "cogs"
  | "adSpends"
  | "adminExp"
  | "netIncome";

/** One calendar month of P&L metrics, used to build the drawer's breakdown. */
export type MetricMonth = {
  key: string; // YYYY-MM
  label: string; // "Jan"
  metrics: MonthlyPnlMetrics;
};

type Props = {
  /** The metric to detail, or null when the drawer is closed. */
  metricId: MetricId | null;
  /** Reference year the breakdown covers (year of the active period). */
  refYear: number;
  /**
   * The latest month with activity in `refYear` (1–12): the current calendar
   * month for the ongoing year, or December for a past year. Bounds the table
   * and the average/peak/YoY windows.
   */
  refMonth: number;
  /** `refYear` metrics, Jan→Dec (12 entries). */
  monthly: MetricMonth[];
  /** `refYear − 1` metrics, Jan→Dec — powers YoY and January's MoM. */
  priorYearMonthly: MetricMonth[];
  onClose: () => void;
};

const META: Record<MetricId, { label: string; invert: boolean }> = {
  grossRevenue: { label: "Gross Revenue", invert: false },
  cogs: { label: "COGS", invert: true },
  adSpends: { label: "Ad Spend", invert: true },
  adminExp: { label: "Operating Exp", invert: true },
  netIncome: { label: "Net income", invert: false },
};

export function StatDetailDrawer({
  metricId,
  refYear,
  refMonth,
  monthly,
  priorYearMonthly,
  onClose,
}: Props) {
  // Retain the last selected metric so the content doesn't blank out while
  // the drawer slides closed.
  const [shown, setShown] = useState<MetricId | null>(metricId);
  useEffect(() => {
    if (metricId) setShown(metricId);
  }, [metricId]);

  const meta = shown ? META[shown] : null;

  const detail = useMemo(() => {
    if (!shown) return null;
    const series = monthly.map((m) => ({
      key: m.key,
      label: m.label,
      value: m.metrics[shown],
    }));
    const prior = priorYearMonthly.map((m) => m.metrics[shown]);
    const elapsed = Math.max(1, Math.min(12, refMonth));

    // One row per elapsed month, with month-over-month change. January's prior
    // month is December of the year before, so it still gets a comparison.
    const rows = series.slice(0, elapsed).map((pt, i) => {
      const prev = i > 0 ? series[i - 1].value : prior[11];
      const momPct =
        prev === 0 || prev === undefined
          ? null
          : ((pt.value - prev) / Math.abs(prev)) * 100;
      return { ...pt, momPct };
    });

    const currentMonth = series[elapsed - 1]?.value ?? 0;
    const currentMonthLabel = series[elapsed - 1]?.label ?? "";
    const fullYear = series.reduce((s, p) => s + p.value, 0);
    const monthlyAverage = fullYear / elapsed;

    // Peak over elapsed months only, so a not-yet-happened (zero) month can't
    // win when every value is negative (e.g. net income).
    let peak = rows[0] ?? null;
    for (const r of rows) if (r.value > peak!.value) peak = r;

    // YoY over the same in-year window (Jan→elapsed) for an apples-to-apples
    // comparison against the prior year.
    const thisWindow = rows.reduce((s, r) => s + r.value, 0);
    const priorWindow = prior.slice(0, elapsed).reduce((s, v) => s + v, 0);
    const yoyPct =
      priorWindow === 0
        ? null
        : ((thisWindow - priorWindow) / Math.abs(priorWindow)) * 100;

    const hasData = rows.some((r) => r.value !== 0) || priorWindow !== 0;

    return {
      rows,
      currentMonth,
      currentMonthLabel,
      fullYear,
      monthlyAverage,
      peak,
      yoyPct,
      hasData,
    };
  }, [shown, monthly, priorYearMonthly, refMonth]);

  return (
    <Drawer
      open={metricId !== null}
      onClose={onClose}
      title={meta ? `${meta.label} — ${refYear}` : undefined}
      width={460}
    >
      {meta && shown && detail ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label={`Current month · ${detail.currentMonthLabel}`}
              value={fmt(detail.currentMonth)}
              danger={shown === "netIncome" && detail.currentMonth < 0}
            />
            <StatTile
              label={`Full year · ${refYear}`}
              value={fmt(detail.fullYear)}
              danger={shown === "netIncome" && detail.fullYear < 0}
            />
            <StatTile
              label="Monthly average"
              value={fmt(detail.monthlyAverage)}
              danger={shown === "netIncome" && detail.monthlyAverage < 0}
            />
            <StatTile
              label={detail.peak ? `Peak · ${detail.peak.label}` : "Peak month"}
              value={detail.peak ? fmt(detail.peak.value) : "—"}
            />
            <YoyTile pct={detail.yoyPct} invert={meta.invert} />
          </div>

          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">
              Monthly breakdown
            </div>
            {!detail.hasData ? (
              <div className="rounded-lg border border-border bg-surface-2/40 p-4 text-center text-xs text-muted">
                No activity for {refYear}.
              </div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                    <th className="py-2 pr-2 text-left font-medium">Month</th>
                    <th className="px-2 py-2 text-right font-medium">Value</th>
                    <th className="py-2 pl-2 text-right font-medium">MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rows.map((r) => (
                    <tr
                      key={r.key}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="py-1.5 pr-2 font-medium text-foreground">
                        {r.label}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono tabular-nums",
                          shown === "netIncome" && r.value < 0
                            ? "text-danger"
                            : "text-foreground",
                        )}
                      >
                        {fmt(r.value)}
                      </td>
                      <MomCell pct={r.momPct} invert={meta.invert} />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function StatTile({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-lg font-semibold",
          danger ? "text-danger" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function YoyTile({ pct, invert }: { pct: number | null; invert: boolean }) {
  const favorable = pct === null ? false : invert ? pct < 0 : pct > 0;
  return (
    <div className="col-span-2 flex items-center justify-between rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
        YoY vs prior year
      </div>
      {pct === null ? (
        <span className="font-mono text-sm text-muted">—</span>
      ) : (
        <span
          className={cn(
            "font-mono text-lg font-semibold",
            favorable ? "text-success" : "text-danger",
          )}
        >
          {pct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(pct))}
        </span>
      )}
    </div>
  );
}

function MomCell({ pct, invert }: { pct: number | null; invert: boolean }) {
  const favorable = pct === null ? false : invert ? pct < 0 : pct > 0;
  return (
    <td className="py-1.5 pl-2 text-right">
      {pct === null ? (
        <span className="font-mono text-[11px] text-muted">—</span>
      ) : (
        <span
          className={cn(
            "font-mono text-[11px] font-medium",
            favorable ? "text-success" : "text-danger",
          )}
        >
          {pct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(pct))}
        </span>
      )}
    </td>
  );
}
