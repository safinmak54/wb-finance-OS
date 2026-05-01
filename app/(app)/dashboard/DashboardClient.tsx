"use client";

import { Stat } from "@/components/ui/Card";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChart } from "@/components/charts/BarChart";
import { fmt, fmtPct } from "@/lib/format";
import type { ReportTxn } from "@/lib/queries/reports";

type Kpis = {
  revenue: number;
  grossProfit: number;
  netIncome: number;
  grossMargin: number;
  netMargin: number;
  cashPosition: number;
  overdueCount: number;
  overdueTotal: number;
};

type Props = {
  kpis: Kpis;
  txns: ReportTxn[];
};

export function DashboardClient({ kpis, txns }: Props) {
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
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={fmt(kpis.revenue)} />
        <Stat
          label="Gross profit"
          value={fmt(kpis.grossProfit)}
          delta={`${fmtPct(kpis.grossMargin)} margin`}
          tone={kpis.grossProfit >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="Net income"
          value={fmt(kpis.netIncome)}
          delta={`${fmtPct(kpis.netMargin)} margin`}
          tone={kpis.netIncome >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="Cash position"
          value={fmt(kpis.cashPosition)}
          tone={kpis.cashPosition >= 0 ? "default" : "negative"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {kpis.overdueCount > 0 ? (
          <Stat
            label="Overdue invoices"
            value={fmt(kpis.overdueTotal)}
            delta={`${kpis.overdueCount} ${kpis.overdueCount === 1 ? "invoice" : "invoices"}`}
            tone="warning"
          />
        ) : null}
      </div>

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
