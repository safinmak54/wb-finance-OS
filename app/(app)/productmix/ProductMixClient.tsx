"use client";

import { Card, CardBody, CardHeader, Stat } from "@/components/ui/Card";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChart } from "@/components/charts/BarChart";
import { fmt } from "@/lib/format";

type Slice = { label: string; amount: number };

type Props = {
  revenueByChannel: Slice[];
  adSpend: Slice[];
  totalRevenue: number;
  totalAd: number;
  roas: number;
};

export function ProductMixClient({
  revenueByChannel,
  adSpend,
  totalRevenue,
  totalAd,
  roas,
}: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Total revenue" value={fmt(totalRevenue)} />
        <Stat label="Ad spend" value={fmt(totalAd)} tone="warning" />
        <Stat
          label="ROAS"
          value={`${roas.toFixed(2)}×`}
          delta="Revenue / Ad spend"
          tone={roas >= 4 ? "positive" : roas >= 2 ? "default" : "negative"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue by channel" subtitle="Selected period" />
          <CardBody>
            {revenueByChannel.length === 0 ? (
              <Empty />
            ) : (
              <DonutChart
                labels={revenueByChannel.map((r) => r.label)}
                values={revenueByChannel.map((r) => r.amount)}
                fmt={fmt}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Ad spend by platform" subtitle="Selected period" />
          <CardBody>
            {adSpend.length === 0 ? (
              <Empty />
            ) : (
              <BarChart
                horizontal
                labels={adSpend.map((r) => r.label)}
                series={[
                  {
                    label: "Spend",
                    data: adSpend.map((r) => r.amount),
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
