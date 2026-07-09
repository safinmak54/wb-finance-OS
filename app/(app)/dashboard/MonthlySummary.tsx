"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { BarChart } from "@/components/charts/BarChart";
import { fmt, fmtPct } from "@/lib/format";
import { PercentToggle, usePercentDisplay } from "@/components/ui/PercentDisplay";
import { cn } from "@/lib/utils/cn";
import type { MonthlyPnlMetrics } from "@/lib/pnl/structure";

type MonthRow = {
  key: string;
  label: string;
  metrics: MonthlyPnlMetrics;
};

type Props = {
  /** Selected year for the summary. */
  year: number;
  /** Years offered in the year dropdown. */
  yearOptions: number[];
  /** Selected month numbers (1–12) — the summary spans these. */
  selectedMonths: number[];
  months: MonthRow[];
};

type MetricKey = keyof MonthlyPnlMetrics;

const COLUMNS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: "grossRevenue", label: "Gross Revenue", color: "#1e3a5f" },
  { key: "cogs", label: "COGS", color: "#dc2626" },
  { key: "adSpends", label: "Ad Spends", color: "#d97706" },
  { key: "adminExp", label: "Operating Exp", color: "#7c3aed" },
  { key: "netIncome", label: "Net Income", color: "#059669" },
];

export function MonthlySummary({
  year,
  yearOptions,
  selectedMonths,
  months,
}: Props) {
  const totals: MonthlyPnlMetrics = {
    grossRevenue: 0,
    cogs: 0,
    adSpends: 0,
    adminExp: 0,
    netIncome: 0,
  };
  for (const m of months) {
    for (const c of COLUMNS) totals[c.key] += m.metrics[c.key];
  }

  const hasData = months.some((m) =>
    COLUMNS.some((c) => m.metrics[c.key] !== 0),
  );

  const [collapsed, setCollapsed] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Monthly summary"
        subtitle="Gross Revenue · COGS · Ad Spends · Operating Exp · Net Income — % of gross revenue"
        actions={
          <>
            <PercentToggle />
            <YearMonthPicker
              year={year}
              yearOptions={yearOptions}
              selectedMonths={selectedMonths}
            />
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2"
              title={collapsed ? "Expand" : "Minimize"}
              aria-expanded={!collapsed}
            >
              <span className="text-[9px]">{collapsed ? "▶" : "▼"}</span>
              {collapsed ? "Expand" : "Minimize"}
            </button>
          </>
        }
      />
      <CardBody className="flex flex-col gap-5">
        {!hasData ? (
          <Empty />
        ) : (
          <>
            <div>
              <BarChart
                labels={months.map((m) => m.label)}
                series={COLUMNS.map((c) => ({
                  label: c.label,
                  data: months.map((m) => m.metrics[c.key]),
                  color: c.color,
                }))}
                yFmt={fmt}
                height={260}
              />
            </div>

            {collapsed ? null : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-2 py-2 text-left font-medium">Month</th>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className="px-2 py-2 text-right font-medium"
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr
                      key={m.key}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-2 py-1.5 font-medium text-foreground">
                        {m.label}
                      </td>
                      {COLUMNS.map((c) => (
                        <MetricCell
                          key={c.key}
                          metricKey={c.key}
                          value={m.metrics[c.key]}
                          grossRevenue={m.metrics.grossRevenue}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border-strong">
                    <td className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Total
                    </td>
                    {COLUMNS.map((c) => (
                      <MetricCell
                        key={c.key}
                        metricKey={c.key}
                        value={totals[c.key]}
                        grossRevenue={totals.grossRevenue}
                        emphasis
                      />
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function MetricCell({
  metricKey,
  value,
  grossRevenue,
  emphasis = false,
}: {
  metricKey: MetricKey;
  value: number;
  grossRevenue: number;
  emphasis?: boolean;
}) {
  const { showPct } = usePercentDisplay();
  const pct = grossRevenue ? (value / grossRevenue) * 100 : null;
  const tone =
    metricKey === "netIncome"
      ? value >= 0
        ? "text-success"
        : "text-danger"
      : "text-foreground";
  return (
    <td className="px-2 py-1.5 text-right">
      <div className="flex items-baseline justify-end gap-2">
        <span
          className={cn(
            "font-mono tabular-nums",
            emphasis ? "font-semibold" : "",
            tone,
          )}
        >
          {fmt(value)}
        </span>
        {showPct && (
          <span className="w-10 shrink-0 text-right text-[10px] text-muted">
            {pct === null ? "—" : fmtPct(pct)}
          </span>
        )}
      </div>
    </td>
  );
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Summary date selector: one year dropdown plus a row of month chips
 * (Jan–Dec) that toggle on and off. The year is chosen once, so the chips
 * don't repeat it. Drives `?summaryYear=…&summaryMonths=1,2,…`.
 */
function YearMonthPicker({
  year,
  yearOptions,
  selectedMonths,
}: {
  year: number;
  yearOptions: number[];
  selectedMonths: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selected = new Set(selectedMonths);

  function push(nextYear: number, nextMonths: number[]) {
    const sp = new URLSearchParams(params.toString());
    sp.set("summaryYear", String(nextYear));
    sp.set("summaryMonths", nextMonths.join(","));
    startTransition(() => router.push(`${pathname}?${sp.toString()}`));
  }

  function onYearChange(nextYear: number) {
    push(nextYear, selectedMonths);
  }

  function toggleMonth(month: number) {
    const next = selected.has(month)
      ? selectedMonths.filter((m) => m !== month)
      : [...selectedMonths, month].sort((a, b) => a - b);
    push(year, next);
  }

  const allSelected = selectedMonths.length === 12;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={year}
        onChange={(e) => onYearChange(Number(e.target.value))}
        disabled={isPending}
        className="rounded-md border border-border bg-surface px-2 py-1 text-[11px]"
        aria-label="Select year"
      >
        {yearOptions.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <div
        className="inline-flex overflow-hidden rounded-md border border-border text-[11px]"
        role="group"
        aria-label="Select months"
      >
        {MONTH_LABELS.map((label, i) => {
          const month = i + 1;
          const active = selected.has(month);
          return (
            <button
              key={month}
              type="button"
              disabled={isPending}
              aria-pressed={active}
              onClick={() => toggleMonth(month)}
              className={cn(
                "px-2 py-1",
                i > 0 && "border-l border-border",
                active
                  ? "bg-info-soft font-medium text-info"
                  : "text-muted hover:bg-surface-2",
                isPending && "opacity-50",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          push(year, allSelected ? [] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        }
        className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2"
      >
        {allSelected ? "Clear" : "All"}
      </button>
    </div>
  );
}

function Empty() {
  return (
    <div className="grid h-[200px] place-items-center text-xs text-muted">
      No data for this period.
    </div>
  );
}
