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
  resolvePeriod,
  yearRange,
  monthlyBuckets,
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

  // Monthly-summary view toggle (independent of the KPI-card period filter).
  const view: MonthlySummaryView =
    sp.view === "ytd"
      ? "ytd"
      : sp.view === "current-month"
        ? "current-month"
        : "monthly";

  // Resolve the month buckets + date range the summary spans.
  let summaryRange: { from: string; to: string };
  let summaryMonths: { key: string; label: string }[];
  if (view === "current-month") {
    const cm = resolvePeriod({ key: "month" });
    const cmKey = cm.from.slice(0, 7);
    summaryRange = { from: cm.from, to: cm.to };
    summaryMonths = monthlyBuckets(Number(cm.from.slice(0, 4))).filter(
      (m) => m.key === cmKey,
    );
  } else if (view === "ytd") {
    const ytd = resolvePeriod({ key: "ytd" });
    const toKey = ytd.to.slice(0, 7);
    summaryRange = { from: ytd.from, to: ytd.to };
    summaryMonths = monthlyBuckets(Number(ytd.from.slice(0, 4))).filter(
      (m) => m.key <= toKey,
    );
  } else {
    const year = Number(period.from.slice(0, 4));
    const yr = yearRange(year);
    summaryRange = { from: yr.from, to: yr.to };
    summaryMonths = monthlyBuckets(year);
  }

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
        <MonthlySummary view={view} months={monthlyRows} />
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
