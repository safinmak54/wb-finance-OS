import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { fetchReportData, groupByAccount } from "@/lib/queries/reports";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import {
  StatementSection,
  type StatementLine,
} from "@/components/financial/StatementSection";

export const dynamic = "force-dynamic";

/**
 * Indirect method cash-flow statement.
 *   - Operating: net income ± changes in operating assets/liabilities
 *   - Investing: changes in long-term assets
 *   - Financing: changes in equity + debt
 *
 * Heuristic mapping uses `accounts.account_subtype`:
 *   - "current" assets/liabilities → operating
 *   - asset (non-current) → investing
 *   - equity / non-current liability → financing
 */

export default async function CashflowPage({
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

  // Net income (period)
  let revenue = 0;
  let expense = 0;
  for (const g of groups) {
    if (!g.account) continue;
    if (g.account.account_type === "revenue") revenue += g.total;
    else if (g.account.account_type === "expense") expense += -g.total;
  }
  const netIncome = revenue - expense;

  function bucket(
    types: ("asset" | "liability" | "equity")[],
    subtypes?: string[],
    excludeSubtype?: string,
  ): { lines: StatementLine[]; total: number } {
    const filtered = groups.filter((g) => {
      if (!g.account) return false;
      if (!types.includes(g.account.account_type as "asset" | "liability" | "equity")) return false;
      if (subtypes && !subtypes.includes(g.account.account_subtype ?? "")) {
        return false;
      }
      if (excludeSubtype && g.account.account_subtype === excludeSubtype) {
        return false;
      }
      return true;
    });
    const lines: StatementLine[] = filtered
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .map((g) => ({
        label: `${g.account?.account_code} · ${g.account?.account_name}`,
        // Liability/equity normal positive; asset flip the sign.
        amount: g.account?.account_type === "asset" ? -g.total : g.total,
      }));
    return {
      lines,
      total: lines.reduce((s, l) => s + l.amount, 0),
    };
  }

  const operating = bucket(["asset", "liability"], ["current"]);
  const operatingLines: StatementLine[] = [
    { label: "Net income", amount: netIncome, emphasis: "subtotal" },
    ...operating.lines,
  ];
  const operatingTotal = netIncome + operating.total;

  const investing = bucket(["asset"], undefined, "current");
  const financing = bucket(["liability", "equity"], undefined, "current");

  const netChange = operatingTotal + investing.total + financing.total;

  return (
    <PageShell
      page="cashflow"
      title="Cash Flow"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity}`}
    >
      <div className="grid grid-cols-1 gap-4">
        <StatementSection
          title="Operating activities"
          lines={operatingLines}
          total={operatingTotal}
          totalLabel="Net cash from operations"
        />
        <StatementSection
          title="Investing activities"
          lines={investing.lines}
          total={investing.total}
          totalLabel="Net cash from investing"
        />
        <StatementSection
          title="Financing activities"
          lines={financing.lines}
          total={financing.total}
          totalLabel="Net cash from financing"
        />
        <div className="flex items-center justify-between rounded-xl border border-border bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-card">
          <span>Net change in cash</span>
          <span className="font-mono text-base">
            {netChange < 0 ? `(${Math.abs(netChange).toLocaleString()})` : netChange.toLocaleString()}
          </span>
        </div>
      </div>
    </PageShell>
  );
}
