import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  fetchReportData,
  fetchPnlReportData,
  groupByAccountAndEntity,
} from "@/lib/queries/reports";
import { listOpenInvoices } from "@/lib/queries/invoices";
import { listAccounts } from "@/lib/queries/accounts";
import {
  listPnlManualEntries,
  mergeManualEntriesIntoAggregates,
} from "@/lib/queries/pnl-manual";
import {
  CODE_TO_SUBTYPE,
  HIDDEN_ACCOUNT_CODES,
  computeMonthlyPnl,
  type MonthlyPnlMetrics,
} from "@/lib/pnl/structure";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import {
  periodFromSearchParams,
  comparisonRange,
  monthlyBuckets,
  monthKeysBetween,
  currentMonthKey,
  type CompareMode,
} from "@/lib/period";
import { DashboardClient } from "./DashboardClient";
import { DashboardFilters } from "./DashboardFilters";
import { MonthlySummary } from "./MonthlySummary";

export const dynamic = "force-dynamic";

/** Sum per-month P&L metrics into a single set of period totals. */
function sumMetrics(metrics: Iterable<MonthlyPnlMetrics>): MonthlyPnlMetrics {
  const totals: MonthlyPnlMetrics = {
    grossRevenue: 0,
    cogs: 0,
    adSpends: 0,
    adminExp: 0,
    netIncome: 0,
  };
  for (const m of metrics) {
    totals.grossRevenue += m.grossRevenue;
    totals.cogs += m.cogs;
    totals.adSpends += m.adSpends;
    totals.adminExp += m.adminExp;
    totals.netIncome += m.netIncome;
  }
  return totals;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  // Period-over-period comparison for the KPI cards (independent of the
  // Monthly-summary view): previous month (MoM) or previous year (YoY).
  const compare: CompareMode | null =
    sp.compare === "mom" || sp.compare === "yoy" ? sp.compare : null;

  // Monthly-summary selector (independent of the KPI-card period filter):
  // pick a year, then toggle which months (Jan–Dec) the summary spans.
  const currentYear = Number(currentMonthKey().slice(0, 4));
  const summaryYear =
    typeof sp.summaryYear === "string" && /^\d{4}$/.test(sp.summaryYear)
      ? Number(sp.summaryYear)
      : currentYear;

  // Year dropdown options: the current year back through four prior years.
  const summaryYearOptions: number[] = [];
  for (let y = currentYear; y >= currentYear - 4; y -= 1) {
    summaryYearOptions.push(y);
  }

  // Selected month numbers (1–12). No param → all 12 selected; an explicit
  // (possibly empty) list is respected so months can be toggled on and off.
  const selectedMonths: number[] =
    typeof sp.summaryMonths === "string"
      ? sp.summaryMonths
          .split(",")
          .map((s) => Number(s))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const selectedSet = new Set(selectedMonths);

  // The month buckets the summary spans, in calendar order.
  const summaryMonths = monthlyBuckets(summaryYear).filter((m) =>
    selectedSet.has(Number(m.key.slice(5, 7))),
  );
  // Fetch bound: first → last selected month (gaps are bucketed out below).
  const summaryRange =
    summaryMonths.length > 0
      ? {
          from: summaryMonths[0].from,
          to: summaryMonths[summaryMonths.length - 1].to,
        }
      : { from: `${summaryYear}-01-01`, to: `${summaryYear}-01-01` };

  // Per-card detail drawer: a full 12-month breakdown of the reference year
  // (the year of the active period's end) plus the prior year, so the drawer
  // can show a Month/Value/MoM table with January comparing to prior December
  // and a full-year YoY. `refMonth` is the current calendar month for the
  // ongoing year, or December for a past year — it bounds the average, peak,
  // and YoY windows so not-yet-happened months don't dilute them.
  const refYear = Number(period.to.slice(0, 4));
  const refMonth =
    refYear === currentYear ? Number(currentMonthKey().slice(5, 7)) : 12;
  const drawerFrom = `${refYear - 1}-01-01`;
  const drawerTo = `${refYear}-12-31`;

  const supabase = createDataClient();

  const [
    reportData,
    openInvoices,
    pnlReport,
    manualEntries,
    kpiPnlReport,
    kpiManualEntries,
    accounts,
    drawerPnlReport,
    drawerManualEntries,
  ] = await Promise.all([
    fetchReportData(supabase, {
      entity,
      from: period.from,
      to: period.to,
    }),
    listOpenInvoices(supabase),
    fetchPnlReportData(supabase, {
      entity,
      from: summaryRange.from,
      to: summaryRange.to,
    }),
    listPnlManualEntries(supabase, {
      from: summaryRange.from,
      to: summaryRange.to,
    }),
    // KPI cards follow the global date filter (the period), independently of
    // the Monthly-summary view below.
    fetchPnlReportData(supabase, {
      entity,
      from: period.from,
      to: period.to,
    }),
    listPnlManualEntries(supabase, {
      from: period.from,
      to: period.to,
    }),
    listAccounts(supabase, { activeOnly: true }),
    fetchPnlReportData(supabase, {
      entity,
      from: drawerFrom,
      to: drawerTo,
    }),
    listPnlManualEntries(supabase, {
      from: drawerFrom,
      to: drawerTo,
    }),
  ]);

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

  // Top KPI cards follow the global date filter (the period). Same P&L
  // mapping/sign/manual-merge as the Monthly summary — the only source that
  // splits expenses into Ad Spend vs Operating Exp — totalled across whatever
  // months the selected period spans (partial end months are bounded by the
  // fetch range, so whole-month buckets still reflect only in-range activity).
  const kpiAggregates = groupByAccountAndEntity(kpiPnlReport.txns);
  mergeManualEntriesIntoAggregates(
    kpiAggregates,
    kpiManualEntries,
    summaryAccounts,
    CODE_TO_SUBTYPE,
  );
  const kpiMetrics = computeMonthlyPnl(
    kpiAggregates,
    summaryAccounts,
    monthKeysBetween(period.from, period.to),
  );
  const kpiTotals = sumMetrics(kpiMetrics.values());
  const kpiNetMargin = kpiTotals.grossRevenue
    ? (kpiTotals.netIncome / kpiTotals.grossRevenue) * 100
    : 0;

  // Per-card detail drawer: reuse the same P&L pipeline over the reference year
  // and the prior year, keyed month-by-month so the drawer can present a
  // 12-month table plus average/peak/YoY. Same mapping/sign/manual-merge as the
  // KPI cards and Monthly summary, so the drawer's numbers tie out to both.
  const drawerAggregates = groupByAccountAndEntity(drawerPnlReport.txns);
  mergeManualEntriesIntoAggregates(
    drawerAggregates,
    drawerManualEntries,
    summaryAccounts,
    CODE_TO_SUBTYPE,
  );
  const drawerMetrics = computeMonthlyPnl(
    drawerAggregates,
    summaryAccounts,
    monthKeysBetween(drawerFrom, drawerTo),
  );
  const drawerMonthly = monthlyBuckets(refYear).map((m) => ({
    key: m.key,
    label: m.label,
    metrics: drawerMetrics.get(m.key)!,
  }));
  const drawerPriorMonthly = monthlyBuckets(refYear - 1).map((m) => ({
    key: m.key,
    label: m.label,
    metrics: drawerMetrics.get(m.key)!,
  }));

  // Run the same P&L pipeline over an arbitrary shifted range so the KPI
  // cards can show a period-over-period delta.
  async function rangeTotals(range: { from: string; to: string }) {
    const [rep, manual] = await Promise.all([
      fetchPnlReportData(supabase, { entity, from: range.from, to: range.to }),
      listPnlManualEntries(supabase, { from: range.from, to: range.to }),
    ]);
    const agg = groupByAccountAndEntity(rep.txns);
    mergeManualEntriesIntoAggregates(
      agg,
      manual,
      summaryAccounts,
      CODE_TO_SUBTYPE,
    );
    const metrics = computeMonthlyPnl(
      agg,
      summaryAccounts,
      monthKeysBetween(range.from, range.to),
    );
    return sumMetrics(metrics.values());
  }

  // The inline card delta follows the compare toggle; only fetch the totals
  // for the active mode (the detail drawer no longer depends on these).
  const compareKpis = compare
    ? await rangeTotals(comparisonRange(period, compare))
    : null;

  return (
    <PageShell
      page="dashboard"
      title="Key Metrics"
      subtitle={`KPIs · ${period.label}`}
      compact
    >
      <div className="flex flex-col gap-4">
        <DashboardFilters
          activeKey={period.key}
          from={period.from}
          to={period.to}
          compare={compare ?? ""}
        />
        <DashboardClient
          kpis={{
            grossRevenue: kpiTotals.grossRevenue,
            cogs: kpiTotals.cogs,
            adSpends: kpiTotals.adSpends,
            adminExp: kpiTotals.adminExp,
            netIncome: kpiTotals.netIncome,
            netMargin: kpiNetMargin,
            overdueCount,
            overdueTotal,
          }}
          compareKpis={compareKpis}
          compareMode={compare}
          drawerYear={refYear}
          drawerMonth={refMonth}
          drawerMonthly={drawerMonthly}
          drawerPriorMonthly={drawerPriorMonthly}
          txns={reportData.txns}
        />
        <MonthlySummary
          year={summaryYear}
          yearOptions={summaryYearOptions}
          selectedMonths={selectedMonths}
          months={monthlyRows}
        />
      </div>
    </PageShell>
  );
}
