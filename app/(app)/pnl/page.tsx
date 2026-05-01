import { PageShell } from "@/components/shell/PageShell";
import { createClient } from "@/lib/supabase/server";
import { fetchReportData, groupByAccount } from "@/lib/queries/reports";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import {
  StatementSection,
  type StatementLine,
} from "@/components/financial/StatementSection";
import { fmt, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = await createClient();
  const data = await fetchReportData(supabase, {
    entity,
    from: period.from,
    to: period.to,
  });

  const groups = groupByAccount(data.txns);

  function lineFor(
    type: "revenue" | "expense",
    subtype?: string | null,
    excludeSubtype?: string,
  ): { lines: StatementLine[]; total: number } {
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
    const lines: StatementLine[] = filtered
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .map((g) => ({
        label: `${g.account?.account_code} · ${g.account?.account_name}`,
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
  const grossProfit = revenue.total - cogs.total;
  const netIncome = grossProfit - expenses.total;
  const grossMargin = revenue.total ? (grossProfit / revenue.total) * 100 : 0;
  const netMargin = revenue.total ? (netIncome / revenue.total) * 100 : 0;

  return (
    <PageShell
      page="pnl"
      title="Profit & Loss"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity}`}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StatementSection
          title="Revenue"
          lines={revenue.lines}
          total={revenue.total}
          totalLabel="Total revenue"
        />
        <StatementSection
          title="Cost of goods sold"
          lines={cogs.lines}
          total={cogs.total}
          totalLabel="Total COGS"
        />
        <StatementSection
          title="Operating expenses"
          lines={expenses.lines}
          total={expenses.total}
          totalLabel="Total OpEx"
        />
        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4 shadow-card">
          <Row label="Revenue" value={revenue.total} />
          <Row label="COGS" value={-cogs.total} />
          <Row
            label="Gross profit"
            value={grossProfit}
            sub={`${fmtPct(grossMargin)} margin`}
            emphasis
          />
          <Row label="Operating expenses" value={-expenses.total} />
          <Row
            label="Net income"
            value={netIncome}
            sub={`${fmtPct(netMargin)} margin`}
            emphasis
          />
        </div>
      </div>
    </PageShell>
  );
}

function Row({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: number;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-1.5 text-xs last:border-b-0 last:pb-0">
      <div className="flex flex-col">
        <span className={emphasis ? "font-semibold" : "text-muted"}>
          {label}
        </span>
        {sub ? <span className="text-[10px] text-muted">{sub}</span> : null}
      </div>
      <span
        className={
          emphasis
            ? value < 0
              ? "font-mono text-base font-bold text-danger"
              : "font-mono text-base font-bold text-foreground"
            : value < 0
              ? "font-mono text-danger"
              : "font-mono"
        }
      >
        {fmt(value)}
      </span>
    </div>
  );
}
