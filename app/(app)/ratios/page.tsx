import { PageShell } from "@/components/shell/PageShell";
import { createClient } from "@/lib/supabase/server";
import { fetchReportData, totals } from "@/lib/queries/reports";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import { Stat } from "@/components/ui/Card";
import { fmt, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RatiosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = await createClient();

  // Period P&L data
  const periodData = await fetchReportData(supabase, {
    entity,
    from: period.from,
    to: period.to,
  });

  // YTD balance-sheet data
  const ytdData = await fetchReportData(supabase, {
    entity,
    from: `${period.to.slice(0, 4)}-01-01`,
    to: period.to,
  });

  const periodTotals = totals(periodData.txns);
  const ytdTotals = totals(ytdData.txns);

  const grossProfit = periodTotals.revenue - periodTotals.cogs;
  const netIncome = grossProfit - periodTotals.expense;

  // Approximations from the YTD totals
  const currentRatio =
    ytdTotals.liability > 0 ? ytdTotals.asset / ytdTotals.liability : 0;
  const debtToEquity =
    ytdTotals.equity !== 0 ? ytdTotals.liability / Math.abs(ytdTotals.equity) : 0;

  const grossMargin = periodTotals.revenue
    ? (grossProfit / periodTotals.revenue) * 100
    : 0;
  const netMargin = periodTotals.revenue
    ? (netIncome / periodTotals.revenue) * 100
    : 0;

  // EBITDA ≈ net income + depreciation/amortization (we don't track those
  // separately yet, so for now treat as = operating income)
  const ebitda = grossProfit - periodTotals.expense;
  const ebitdaMargin = periodTotals.revenue
    ? (ebitda / periodTotals.revenue) * 100
    : 0;

  return (
    <PageShell
      page="ratios"
      title="Ratios & KPIs"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity}`}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Current ratio"
          value={currentRatio.toFixed(2)}
          delta="Assets / Liabilities (YTD)"
          tone={currentRatio >= 1.5 ? "positive" : currentRatio >= 1 ? "default" : "negative"}
        />
        <Stat
          label="Debt to equity"
          value={debtToEquity.toFixed(2)}
          delta="Liabilities / |Equity|"
          tone={debtToEquity <= 1 ? "positive" : debtToEquity <= 2 ? "default" : "negative"}
        />
        <Stat
          label="Gross margin"
          value={fmtPct(grossMargin)}
          delta={fmt(grossProfit)}
          tone={grossMargin >= 30 ? "positive" : grossMargin >= 15 ? "default" : "negative"}
        />
        <Stat
          label="Net margin"
          value={fmtPct(netMargin)}
          delta={fmt(netIncome)}
          tone={netMargin >= 10 ? "positive" : netMargin >= 0 ? "default" : "negative"}
        />
        <Stat
          label="EBITDA"
          value={fmt(ebitda)}
          delta={`${fmtPct(ebitdaMargin)} margin`}
          tone={ebitda >= 0 ? "positive" : "negative"}
        />
        <Stat label="Revenue" value={fmt(periodTotals.revenue)} />
      </div>
    </PageShell>
  );
}
