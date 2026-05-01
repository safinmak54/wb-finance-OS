import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listCashBalances } from "@/lib/queries/cash";
import { fetchReportData, totals } from "@/lib/queries/reports";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Simple 13-week rolling cash forecast. Starting cash comes from
 * `cash_balances` (sum of section-1 minus payables). Weekly inflow /
 * outflow is extrapolated from the trailing 30-day average run-rate
 * for revenue and operating expense.
 *
 * Legacy had this as an empty stub; this is a v1 read-only view that
 * we can iterate on later when a forecast_assumptions table lands.
 */
export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const entity = entityFilterFromSearchParams(sp);
  const supabase = createDataClient();

  const today = new Date().toISOString().slice(0, 10);
  const trailing30 = new Date(
    Date.now() - 30 * 24 * 3600 * 1000,
  )
    .toISOString()
    .slice(0, 10);

  const [cashRows, recent] = await Promise.all([
    listCashBalances(supabase),
    fetchReportData(supabase, { entity, from: trailing30, to: today }),
  ]);

  // Starting cash
  const sec1Keys = ["tfb", "hunt", "vend_pay", "cc", "int_xfer", "google", "hunt_bal"];
  const payableKeys = ["cc_pay", "vend_pmts", "goog_pend", "fedex"];
  let cashTotal = 0;
  let payTotal = 0;
  for (const r of cashRows) {
    const v = Number(r.value ?? 0);
    if (sec1Keys.includes(r.col_key)) cashTotal += v;
    else if (payableKeys.includes(r.col_key)) payTotal += Math.abs(v);
  }
  const startingCash = cashTotal - payTotal;

  // Trailing-30-day run-rate
  const t = totals(recent.txns);
  const weeklyInflow = (t.revenue / 30) * 7;
  const weeklyOutflow = ((t.cogs + t.expense) / 30) * 7;

  const weeks = Array.from({ length: 13 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + (i + 1) * 7);
    return {
      label: `Wk ${i + 1}`,
      ending: d.toISOString().slice(0, 10),
    };
  });

  const rows = weeks.reduce<
    Array<{
      label: string;
      ending: string;
      starting: number;
      inflow: number;
      outflow: number;
      ending_cash: number;
    }>
  >((acc, w) => {
    const starting = acc.length === 0 ? startingCash : acc[acc.length - 1].ending_cash;
    const ending_cash = starting + weeklyInflow - weeklyOutflow;
    acc.push({
      label: w.label,
      ending: w.ending,
      starting,
      inflow: weeklyInflow,
      outflow: weeklyOutflow,
      ending_cash,
    });
    return acc;
  }, []);

  return (
    <PageShell
      page="forecast"
      title="Cash Forecast"
      subtitle={`13-week rolling · trailing-30-day run-rate · ${entity === "all" ? "All entities" : entity}`}
    >
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Week</th>
              <th className="px-3 py-2 text-left">Ending</th>
              <th className="px-3 py-2 text-right">Starting</th>
              <th className="px-3 py-2 text-right">Inflow</th>
              <th className="px-3 py-2 text-right">Outflow</th>
              <th className="px-3 py-2 text-right">Ending cash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <td className="px-3 py-1.5 font-medium">{r.label}</td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-muted">{r.ending}</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmt(r.starting)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-success">
                  +{fmt(r.inflow)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-danger">
                  -{fmt(r.outflow)}
                </td>
                <td
                  className={
                    r.ending_cash < 0
                      ? "px-3 py-1.5 text-right font-mono font-semibold text-danger"
                      : "px-3 py-1.5 text-right font-mono font-semibold"
                  }
                >
                  {fmt(r.ending_cash)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
