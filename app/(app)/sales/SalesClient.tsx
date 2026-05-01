"use client";

import { Card, CardBody, CardHeader, Stat } from "@/components/ui/Card";
import { LineChart } from "@/components/charts/LineChart";
import { fmt } from "@/lib/format";

type Props = {
  byDay: Array<{ day: string; revenue: number }>;
  total: number;
  count: number;
};

export function SalesClient({ byDay, total, count }: Props) {
  const labels = byDay.map((d) => d.day.slice(5));
  const data = byDay.map((d) => d.revenue);

  const avg = count > 0 ? total / count : 0;
  const peakDay = byDay.reduce<{ day: string; revenue: number } | null>(
    (acc, d) => (acc === null || d.revenue > acc.revenue ? d : acc),
    null,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total revenue" value={fmt(total)} />
        <Stat label="Transactions" value={String(count)} />
        <Stat label="Avg transaction" value={fmt(avg)} />
        <Stat
          label="Peak day"
          value={peakDay ? fmt(peakDay.revenue) : "—"}
          delta={peakDay?.day}
        />
      </div>

      <Card>
        <CardHeader title="Revenue by day" subtitle="Period totals" />
        <CardBody>
          {data.length === 0 ? (
            <div className="grid h-[200px] place-items-center text-xs text-muted">
              No revenue in this period.
            </div>
          ) : (
            <LineChart
              labels={labels}
              series={[
                {
                  label: "Revenue",
                  data,
                  color: "#10b981",
                  fill: true,
                },
              ]}
              yFmt={fmt}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
