"use client";

import { Bar } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import { registerChartJs } from "./register";

registerChartJs();

type Props = {
  labels: string[];
  series: Array<{
    label: string;
    data: number[];
    color?: string;
  }>;
  height?: number;
  yFmt?: (n: number) => string;
  horizontal?: boolean;
  stacked?: boolean;
};

export function BarChart({
  labels,
  series,
  height = 220,
  yFmt,
  horizontal = false,
  stacked = false,
}: Props) {
  const data: ChartData<"bar"> = {
    labels,
    datasets: series.map((s) => ({
      label: s.label,
      data: s.data,
      backgroundColor: s.color ?? "#1e3a5f",
      borderRadius: 4,
      maxBarThickness: 32,
    })),
  };

  const options: ChartOptions<"bar"> = {
    indexAxis: horizontal ? "y" : "x",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { font: { size: 11 } } },
      tooltip: {
        callbacks: yFmt
          ? {
              label: (ctx) => `${ctx.dataset.label}: ${yFmt(Number(ctx.parsed[horizontal ? "x" : "y"]))}`,
            }
          : undefined,
      },
    },
    scales: {
      x: { stacked, grid: { display: !horizontal && false } },
      y: {
        stacked,
        ticks: yFmt && !horizontal
          ? { callback: (v) => yFmt(Number(v)) }
          : undefined,
        grid: { color: "#e8ecf0" },
      },
    },
  };

  return (
    <div style={{ height }}>
      <Bar data={data} options={options} />
    </div>
  );
}
