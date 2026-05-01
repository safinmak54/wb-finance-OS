"use client";

import { Line } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import { registerChartJs } from "./register";

registerChartJs();

type Props = {
  labels: string[];
  series: Array<{
    label: string;
    data: number[];
    color?: string;
    fill?: boolean;
  }>;
  height?: number;
  yFmt?: (n: number) => string;
};

export function LineChart({ labels, series, height = 220, yFmt }: Props) {
  const data: ChartData<"line"> = {
    labels,
    datasets: series.map((s) => ({
      label: s.label,
      data: s.data,
      borderColor: s.color ?? "#1e3a5f",
      backgroundColor: s.fill ? (s.color ?? "#1e3a5f") + "22" : "transparent",
      fill: Boolean(s.fill),
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2,
    })),
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { font: { size: 11 } } },
      tooltip: {
        callbacks: yFmt
          ? {
              label: (ctx) => `${ctx.dataset.label}: ${yFmt(Number(ctx.parsed.y))}`,
            }
          : undefined,
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        ticks: yFmt ? { callback: (v) => yFmt(Number(v)) } : undefined,
        grid: { color: "#e8ecf0" },
      },
    },
  };

  return (
    <div style={{ height }}>
      <Line data={data} options={options} />
    </div>
  );
}
