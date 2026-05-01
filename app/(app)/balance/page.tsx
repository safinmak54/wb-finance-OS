import { PageShell } from "@/components/shell/PageShell";
import { createClient } from "@/lib/supabase/server";
import { fetchReportData, groupByAccount } from "@/lib/queries/reports";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import {
  StatementSection,
  type StatementLine,
} from "@/components/financial/StatementSection";

export const dynamic = "force-dynamic";

export default async function BalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = await createClient();

  // Balance sheet is YTD-from-start through period.to to capture the
  // full balance up to the date.
  const yearStart = `${period.to.slice(0, 4)}-01-01`;
  const data = await fetchReportData(supabase, {
    entity,
    from: yearStart,
    to: period.to,
  });

  const groups = groupByAccount(data.txns);

  function lineFor(
    type: "asset" | "liability" | "equity",
  ): { lines: StatementLine[]; total: number } {
    const filtered = groups.filter((g) => g.account?.account_type === type);
    const lines: StatementLine[] = filtered
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .map((g) => ({
        label: `${g.account?.account_code} · ${g.account?.account_name}`,
        // Asset: signed amount in legacy is negative for debits; flip.
        amount:
          type === "asset"
            ? -g.total
            : type === "liability"
              ? g.total
              : g.total,
      }));
    const total = lines.reduce((s, l) => s + l.amount, 0);
    return { lines, total };
  }

  // Retained earnings = revenue - expense (book net income) for YTD
  let revenueTotal = 0;
  let expenseTotal = 0;
  for (const g of groups) {
    if (!g.account) continue;
    if (g.account.account_type === "revenue") revenueTotal += g.total;
    else if (g.account.account_type === "expense") expenseTotal += -g.total;
  }
  const retainedEarnings = revenueTotal - expenseTotal;

  const assets = lineFor("asset");
  const liabilities = lineFor("liability");
  const equity = lineFor("equity");

  // Add retained earnings as a synthetic equity line
  if (retainedEarnings !== 0) {
    equity.lines.push({
      label: "Retained earnings (YTD net income)",
      amount: retainedEarnings,
      emphasis: "muted",
    });
    equity.total += retainedEarnings;
  }

  const totalLE = liabilities.total + equity.total;
  const balanced = Math.abs(assets.total - totalLE) < 0.5;

  return (
    <PageShell
      page="balance"
      title="Balance Sheet"
      subtitle={`As of ${period.to} · ${entity === "all" ? "All entities" : entity}`}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StatementSection
          title="Assets"
          lines={assets.lines}
          total={assets.total}
          totalLabel="Total assets"
        />
        <div className="flex flex-col gap-4">
          <StatementSection
            title="Liabilities"
            lines={liabilities.lines}
            total={liabilities.total}
            totalLabel="Total liabilities"
          />
          <StatementSection
            title="Equity"
            lines={equity.lines}
            total={equity.total}
            totalLabel="Total equity"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Stat label="Total assets" value={assets.total} />
        <Stat label="Liabilities + Equity" value={totalLE} />
        <Stat
          label={balanced ? "✓ Balanced" : "⚠ Out of balance"}
          value={assets.total - totalLE}
          tone={balanced ? "positive" : "negative"}
        />
      </div>
    </PageShell>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
        {label}
      </div>
      <div
        className={
          tone === "positive"
            ? "mt-1.5 font-mono text-xl font-semibold text-success"
            : tone === "negative"
              ? "mt-1.5 font-mono text-xl font-semibold text-danger"
              : "mt-1.5 font-mono text-xl font-semibold text-foreground"
        }
      >
        {value < 0 ? `(${Math.abs(value).toLocaleString()})` : value.toLocaleString()}
      </div>
    </div>
  );
}
