import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  fetchReportData,
  fetchPnlReportData,
  groupByAccountAndEntity,
  totals,
} from "@/lib/queries/reports";
import { listOpenInvoices } from "@/lib/queries/invoices";
import { listCashBalances } from "@/lib/queries/cash";
import { listAccounts } from "@/lib/queries/accounts";
import {
  listPnlManualEntries,
  mergeManualEntriesIntoAggregates,
} from "@/lib/queries/pnl-manual";
import {
  CODE_TO_SUBTYPE,
  HIDDEN_ACCOUNT_CODES,
  computeMonthlyPnl,
} from "@/lib/pnl/structure";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import {
  periodFromSearchParams,
  monthlyBuckets,
  recentMonths,
  currentMonthKey,
} from "@/lib/period";
import { DashboardClient } from "./DashboardClient";
import {
  MonthlySummary,
  type MonthlySummaryView,
} from "./MonthlySummary";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  // Monthly-summary view toggle (independent of the KPI-card period filter):
  // full year, a single quarter (q1–q4), or one individual month.
  const view: MonthlySummaryView =
    sp.view === "q1" ||
    sp.view === "q2" ||
    sp.view === "q3" ||
    sp.view === "q4" ||
    sp.view === "month"
      ? sp.view
      : "year";

  // Per-month view: a single user-selected month (defaults to current month).
  const monthOptions = recentMonths(24);
  const selectedMonth =
    typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month)
      ? sp.month
      : currentMonthKey();

  // Resolve the month buckets + date range the summary spans.
  let summaryMonths: { key: string; label: string; from: string; to: string }[];
  if (view === "month") {
    const my = Number(selectedMonth.slice(0, 4));
    summaryMonths = monthlyBuckets(my).filter((m) => m.key === selectedMonth);
  } else if (view === "q1" || view === "q2" || view === "q3" || view === "q4") {
    const year = Number(period.from.slice(0, 4));
    const qIdx = Number(view.slice(1)) - 1; // 0..3
    summaryMonths = monthlyBuckets(year).slice(qIdx * 3, qIdx * 3 + 3);
  } else {
    const year = Number(period.from.slice(0, 4));
    summaryMonths = monthlyBuckets(year);
  }
  const summaryRange = {
    from: summaryMonths[0].from,
    to: summaryMonths[summaryMonths.length - 1].to,
  };

  const supabase = createDataClient();

  const [reportData, openInvoices, cashRows, pnlReport, manualEntries, accounts] =
    await Promise.all([
      fetchReportData(supabase, {
        entity,
        from: period.from,
        to: period.to,
      }),
      listOpenInvoices(supabase),
      listCashBalances(supabase),
      fetchPnlReportData(supabase, {
        entity,
        from: summaryRange.from,
        to: summaryRange.to,
      }),
      listPnlManualEntries(supabase, {
        from: summaryRange.from,
        to: summaryRange.to,
      }),
      listAccounts(supabase, { activeOnly: true }),
    ]);

  const t = totals(reportData.txns);
  const grossProfit = t.revenue - t.cogs;
  const netIncome = grossProfit - t.expense;
  const grossMargin = t.revenue ? (grossProfit / t.revenue) * 100 : 0;
  const netMargin = t.revenue ? (netIncome / t.revenue) * 100 : 0;

  // Cash position = sum of section-1 columns minus payables
  const sec1Keys = ["tfb", "hunt", "vend_pay", "cc", "int_xfer", "google", "hunt_bal"];
  const payableKeys = ["cc_pay", "vend_pmts", "goog_pend", "fedex"];
  let cashTotal = 0;
  let payTotal = 0;
  for (const r of cashRows) {
    const v = Number(r.value ?? 0);
    if (sec1Keys.includes(r.col_key)) cashTotal += v;
    else if (payableKeys.includes(r.col_key)) payTotal += Math.abs(v);
  }

  const overdueCount = openInvoices.filter((i) => i.status === "overdue").length;
  const overdueTotal = openInvoices
    .filter((i) => i.status === "overdue")
    .reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid ?? 0), 0);

  // Month-wise P&L summary (Gross Revenue, COGS, Ad Spends, Admin Exp, Net
  // Income). Reuses the exact P&L mapping/sign/manual-merge so numbers tie
  // out to the P&L report.
  const summaryAccounts = accounts.filter(
    (a) => !HIDDEN_ACCOUNT_CODES.has(a.account_code),
  );
  const aggregates = groupByAccountAndEntity(pnlReport.txns);
  mergeManualEntriesIntoAggregates(
    aggregates,
    manualEntries,
    summaryAccounts,
    CODE_TO_SUBTYPE,
  );
  const monthlyMetrics = computeMonthlyPnl(
    aggregates,
    summaryAccounts,
    summaryMonths.map((m) => m.key),
  );
  const monthlyRows = summaryMonths.map((m) => ({
    key: m.key,
    label: m.label,
    metrics: monthlyMetrics.get(m.key)!,
  }));

  return (
    <PageShell
      page="dashboard"
      title="Dashboard"
      subtitle={`KPIs · ${period.label}`}
    >
      <div className="flex flex-col gap-5">
        <MonthlySummary
          view={view}
          months={monthlyRows}
          selectedMonth={selectedMonth}
          monthOptions={monthOptions}
        />
        <DashboardClient
          kpis={{
            revenue: t.revenue,
            grossProfit,
            netIncome,
            grossMargin,
            netMargin,
            cashPosition: cashTotal - payTotal,
            overdueCount,
            overdueTotal,
          }}
          txns={reportData.txns}
        />
      </div>
    </PageShell>
  );
}
