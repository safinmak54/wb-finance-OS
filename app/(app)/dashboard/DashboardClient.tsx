"use client";

import { useState } from "react";
import type { StatChange } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Card";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChart } from "@/components/charts/BarChart";
import { fmt, fmtPct } from "@/lib/format";
import type { CompareMode } from "@/lib/period";
import type { ReportTxn } from "@/lib/queries/reports";
import {
  StatDetailDrawer,
  type MetricId,
  type MetricMonth,
} from "./StatDetailDrawer";

type Kpis = {
  grossRevenue: number;
  cogs: number;
  adSpends: number;
  adminExp: number;
  netIncome: number;
  netMargin: number;
  overdueCount: number;
  overdueTotal: number;
};

/** Prior-period KPI totals (same shape, sans derived fields). */
type CompareKpis = {
  grossRevenue: number;
  cogs: number;
  adSpends: number;
  adminExp: number;
  netIncome: number;
};

type Props = {
  kpis: Kpis;
  compareKpis: CompareKpis | null;
  compareMode: CompareMode | null;
  /** Reference year the per-card detail drawer breaks down. */
  drawerYear: number;
  /** Latest month with activity in `drawerYear` (1–12). */
  drawerMonth: number;
  /** `drawerYear` monthly P&L series (Jan→Dec), for the detail drawer. */
  drawerMonthly: MetricMonth[];
  /** `drawerYear − 1` monthly P&L series (Jan→Dec), for YoY / January MoM. */
  drawerPriorMonthly: MetricMonth[];
  txns: ReportTxn[];
};

const COMPARE_LABEL: Record<CompareMode, string> = {
  mom: "vs prior month",
  yoy: "vs prior year",
};

export function DashboardClient({
  kpis,
  compareKpis,
  compareMode,
  drawerYear,
  drawerMonth,
  drawerMonthly,
  drawerPriorMonthly,
  txns,
}: Props) {
  const [selected, setSelected] = useState<MetricId | null>(null);

  // Build the period-over-period change shown under a KPI value. `invert` is
  // true for cost metrics, where a decrease is the favorable direction.
  function changeFor(
    current: number,
    prior: number | undefined,
    invert: boolean,
  ): StatChange | undefined {
    if (!compareMode) return undefined;
    const label = COMPARE_LABEL[compareMode];
    if (prior === undefined || prior === 0) {
      return { pct: null, favorable: false, label };
    }
    const pct = ((current - prior) / Math.abs(prior)) * 100;
    return { pct, favorable: invert ? pct < 0 : pct > 0, label };
  }

  // Group revenue by source (Stripe/PayPal/Wire) using account_subtype + name
  const revenueByName = new Map<string, number>();
  const expenseByLine = new Map<string, number>();
  for (const t of txns) {
    if (!t.accounts) continue;
    const amt = Number(t.amount ?? 0);
    if (t.accounts.account_type === "revenue") {
      revenueByName.set(
        t.accounts.account_name,
        (revenueByName.get(t.accounts.account_name) ?? 0) + amt,
      );
    } else if (t.accounts.account_type === "expense") {
      expenseByLine.set(
        t.accounts.account_name,
        (expenseByLine.get(t.accounts.account_name) ?? 0) + Math.abs(amt),
      );
    }
  }

  const revLabels = [...revenueByName.keys()];
  const revValues = [...revenueByName.values()];
  const topExpense = [...expenseByLine.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Gross Revenue"
          value={fmt(kpis.grossRevenue)}
          strong
          change={changeFor(kpis.grossRevenue, compareKpis?.grossRevenue, false)}
          onClick={() => setSelected("grossRevenue")}
        />
        <Stat
          label="COGS"
          value={fmt(kpis.cogs)}
          strong
          change={changeFor(kpis.cogs, compareKpis?.cogs, true)}
          onClick={() => setSelected("cogs")}
        />
        <Stat
          label="Ad Spend"
          value={fmt(kpis.adSpends)}
          strong
          change={changeFor(kpis.adSpends, compareKpis?.adSpends, true)}
          onClick={() => setSelected("adSpends")}
        />
        <Stat
          label="Operating Exp"
          value={fmt(kpis.adminExp)}
          strong
          change={changeFor(kpis.adminExp, compareKpis?.adminExp, true)}
          onClick={() => setSelected("adminExp")}
        />
        <Stat
          label="Net income"
          value={fmt(kpis.netIncome)}
          strong
          delta={`${fmtPct(kpis.netMargin)} margin`}
          tone={kpis.netIncome >= 0 ? "positive" : "negative"}
          change={changeFor(kpis.netIncome, compareKpis?.netIncome, false)}
          onClick={() => setSelected("netIncome")}
        />
      </div>

      {kpis.overdueCount > 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Stat
            label="Overdue invoices"
            value={fmt(kpis.overdueTotal)}
            delta={`${kpis.overdueCount} ${kpis.overdueCount === 1 ? "invoice" : "invoices"}`}
            tone="warning"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue by source" subtitle="Selected period" />
          <CardBody>
            {revValues.length === 0 ? (
              <Empty />
            ) : (
              <DonutChart labels={revLabels} values={revValues} fmt={fmt} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top expenses" subtitle="By account" />
          <CardBody>
            {topExpense.length === 0 ? (
              <Empty />
            ) : (
              <BarChart
                horizontal
                labels={topExpense.map(([k]) => k)}
                series={[
                  {
                    label: "Spend",
                    data: topExpense.map(([, v]) => v),
                    color: "#dc2626",
                  },
                ]}
                yFmt={fmt}
              />
            )}
          </CardBody>
        </Card>
      </div>

      <StatDetailDrawer
        metricId={selected}
        refYear={drawerYear}
        refMonth={drawerMonth}
        monthly={drawerMonthly}
        priorYearMonthly={drawerPriorMonthly}
        onClose={() => setSelected(null)}
      />
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
