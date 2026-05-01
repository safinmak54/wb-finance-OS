"use client";

import { Doughnut } from "react-chartjs-2";
import type { ChartData, ChartOptions } from "chart.js";
import { registerChartJs } from "./register";

registerChartJs();

const DEFAULT_COLORS = [
  "#1e3a5f",
  "#2563eb",
  "#10b981",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#94a3b8",
  "#0ea5e9",
];

type Props = {
  labels: string[];
  values: number[];
  colors?: string[];
  height?: number;
  legendPosition?: "bottom" | "right";
  centerLabel?: string;
  fmt?: (n: number) => string;
};

export function DonutChart({
  labels,
  values,
  colors = DEFAULT_COLORS,
  height = 240,
  legendPosition = "bottom",
  fmt,
}: Props) {
  const data: ChartData<"doughnut"> = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: labels.map((_, i) => colors[i % colors.length]),
        borderWidth: 0,
      },
    ],
  };

  const options: ChartOptions<"doughnut"> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "65%",
    plugins: {
      legend: {
        position: legendPosition,
        labels: { font: { size: 11 }, boxWidth: 10 },
      },
      tooltip: {
        callbacks: fmt
          ? { label: (ctx) => `${ctx.label}: ${fmt(Number(ctx.parsed))}` }
          : undefined,
      },
    },
  };

  return (
    <div style={{ height }}>
      <Doughnut data={data} options={options} />
    </div>
  );
}
