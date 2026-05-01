import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { fetchReportData, totals } from "@/lib/queries/reports";
import { listOpenInvoices } from "@/lib/queries/invoices";
import { listCashBalances } from "@/lib/queries/cash";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = createDataClient();

  const [reportData, openInvoices, cashRows] = await Promise.all([
    fetchReportData(supabase, {
      entity,
      from: period.from,
      to: period.to,
    }),
    listOpenInvoices(supabase),
    listCashBalances(supabase),
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

  return (
    <PageShell
      page="dashboard"
      title="Dashboard"
      subtitle={`KPIs · ${period.label}`}
    >
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
    </PageShell>
  );
}
