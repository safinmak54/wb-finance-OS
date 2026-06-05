"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { BarChart } from "@/components/charts/BarChart";
import { fmt, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { MonthlyPnlMetrics } from "@/lib/pnl/structure";

export type MonthlySummaryView = "monthly" | "ytd" | "current-month";

type MonthRow = {
  key: string;
  label: string;
  metrics: MonthlyPnlMetrics;
};

type Props = {
  view: MonthlySummaryView;
  months: MonthRow[];
};

type MetricKey = keyof MonthlyPnlMetrics;

const COLUMNS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: "grossRevenue", label: "Gross Revenue", color: "#1e3a5f" },
  { key: "cogs", label: "COGS", color: "#dc2626" },
  { key: "adSpends", label: "Ad Spends", color: "#d97706" },
  { key: "adminExp", label: "Admin Exp", color: "#7c3aed" },
  { key: "netIncome", label: "Net Income", color: "#059669" },
];

export function MonthlySummary({ view, months }: Props) {
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
        subtitle="Gross Revenue · COGS · Ad Spends · Admin Exp · Net Income — % of gross revenue"
        actions={<ViewToggle current={view} />}
      />
      <CardBody className="flex flex-col gap-5">
        {!hasData ? (
          <Empty />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[640px] border-collapse text-sm">
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
                      <td className="px-2 py-2 font-medium text-foreground">
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
                    <td className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
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
    <td className="px-2 py-2 text-right">
      <div
        className={cn(
          "font-mono tabular-nums",
          emphasis ? "font-semibold" : "",
          tone,
        )}
      >
        {fmt(value)}
      </div>
      <div className="text-[11px] text-muted">
        {pct === null ? "—" : fmtPct(pct)}
      </div>
    </td>
  );
}

const VIEW_OPTIONS: Array<{ value: MonthlySummaryView; label: string }> = [
  { value: "ytd", label: "YTD" },
  { value: "monthly", label: "Monthly" },
  { value: "current-month", label: "Current Month" },
];

function ViewToggle({ current }: { current: MonthlySummaryView }) {
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(value: MonthlySummaryView): string {
    const sp = new URLSearchParams(params.toString());
    sp.set("view", value);
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
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
  );
}

function Empty() {
  return (
    <div className="grid h-[200px] place-items-center text-xs text-muted">
      No data for this period.
    </div>
  );
}
