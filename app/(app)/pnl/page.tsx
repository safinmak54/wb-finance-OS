import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  fetchReportData,
  groupByAccount,
  pnlAdjustment,
} from "@/lib/queries/reports";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import { PnlClient, type PnlLine } from "./PnlClient";

export const dynamic = "force-dynamic";

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = createDataClient();
  const data = await fetchReportData(supabase, {
    entity,
    from: period.from,
    to: period.to,
  });

  const groups = groupByAccount(data.txns);
  const adjustment = pnlAdjustment(data.journals);

  function lineFor(
    type: "revenue" | "expense",
    subtype?: string | null,
    excludeSubtype?: string,
  ): { lines: PnlLine[]; total: number } {
    const filtered = groups.filter((g) => {
      if (!g.account) return false;
      if (g.account.account_type !== type) return false;
      if (subtype !== undefined && g.account.account_subtype !== subtype) {
        return false;
      }
      if (excludeSubtype && g.account.account_subtype === excludeSubtype) {
        return false;
      }
      return true;
    });
    const lines: PnlLine[] = filtered
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .map((g) => ({
        accountId: g.account!.id,
        label: `${g.account!.account_code} · ${g.account!.account_name}`,
        amount: type === "revenue" ? g.total : -g.total,
      }));
    const total = filtered.reduce(
      (s, g) => s + (type === "revenue" ? g.total : -g.total),
      0,
    );
    return { lines, total };
  }

  const revenue = lineFor("revenue");
  const cogs = lineFor("expense", "cogs");
  const expenses = lineFor("expense", undefined, "cogs");

  // Apply adjusting/accrual JE deltas (mirrors legacy P&L summary blend)
  const adjustedRevenue = revenue.total + adjustment.revenue;
  const adjustedCogs = cogs.total + adjustment.cogs;
  const adjustedExpenses = expenses.total + adjustment.expense;

  const grossProfit = adjustedRevenue - adjustedCogs;
  const netIncome = grossProfit - adjustedExpenses;
  const grossMargin = adjustedRevenue
    ? (grossProfit / adjustedRevenue) * 100
    : 0;
  const netMargin = adjustedRevenue ? (netIncome / adjustedRevenue) * 100 : 0;

  return (
    <PageShell
      page="pnl"
      title="Profit & Loss"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity}`}
    >
      <PnlClient
        data={{
          revenue,
          cogs,
          expenses,
          totals: {
            grossProfit,
            netIncome,
            grossMargin,
            netMargin,
            adjustment,
          },
          range: { from: period.from, to: period.to },
          entity,
        }}
      />
    </PageShell>
  );
}
