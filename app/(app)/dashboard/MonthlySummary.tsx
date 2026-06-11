"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { BarChart } from "@/components/charts/BarChart";
import { fmt, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { MonthlyPnlMetrics } from "@/lib/pnl/structure";

export type MonthlySummaryView =
  | "year"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "month";

type MonthRow = {
  key: string;
  label: string;
  metrics: MonthlyPnlMetrics;
};

type Props = {
  view: MonthlySummaryView;
  months: MonthRow[];
  selectedMonth: string;
  monthOptions: Array<{ key: string; label: string }>;
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
  view,
  months,
  selectedMonth,
  monthOptions,
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

  return (
    <Card>
      <CardHeader
        title="Monthly summary"
        subtitle="Gross Revenue · COGS · Ad Spends · Operating Exp · Net Income — % of gross revenue"
        actions={
          <ViewToggle
            current={view}
            selectedMonth={selectedMonth}
            monthOptions={monthOptions}
          />
        }
      />
      <CardBody className="flex flex-col gap-5">
        {!hasData ? (
          <Empty />
        ) : (
          <>
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
        <span className="w-10 shrink-0 text-right text-[10px] text-muted">
          {pct === null ? "—" : fmtPct(pct)}
        </span>
      </div>
    </td>
  );
}

const VIEW_OPTIONS: Array<{ value: MonthlySummaryView; label: string }> = [
  { value: "year", label: "Full Year" },
  { value: "q1", label: "Q1" },
  { value: "q2", label: "Q2" },
  { value: "q3", label: "Q3" },
  { value: "q4", label: "Q4" },
  { value: "month", label: "Month" },
];

function ViewToggle({
  current,
  selectedMonth,
  monthOptions,
}: {
  current: MonthlySummaryView;
  selectedMonth: string;
  monthOptions: Array<{ key: string; label: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(value: MonthlySummaryView): string {
    const sp = new URLSearchParams(params.toString());
    sp.set("view", value);
    // Carry the selected month so toggling into "Month" lands somewhere sane.
    if (value === "month" && !sp.get("month")) sp.set("month", selectedMonth);
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function onMonthChange(month: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set("view", "month");
    sp.set("month", month);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-md border border-border text-[11px]">
        {VIEW_OPTIONS.map((o, i) => (
          <Link
            key={o.value}
            href={hrefFor(o.value)}
            className={cn(
              "px-2 py-1",
              i > 0 && "border-l border-border",
              current === o.value
                ? "bg-info-soft text-info"
                : "text-muted hover:bg-surface-2",
            )}
          >
            {o.label}
          </Link>
        ))}
      </div>
      {current === "month" && (
        <select
          value={selectedMonth}
          onChange={(e) => onMonthChange(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-[11px]"
          aria-label="Select month"
        >
          {monthOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      )}
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
