"use client";

import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";

let registered = false;

export function registerChartJs() {
  if (registered) return;
  Chart.register(
    ArcElement,
    BarElement,
    CategoryScale,
    Filler,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    Tooltip,
  );
  Chart.defaults.font.family =
    "var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif";
  Chart.defaults.color = "#64748b";
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  registered = true;
}
