import Link from "next/link";
import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  fetchBalanceSheetData,
  fetchReportData,
  groupBalanceByAccount,
  monthlyBalanceSnapshots,
} from "@/lib/queries/reports";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import {
  periodFromSearchParams,
  monthlyBuckets,
  resolvePeriod,
} from "@/lib/period";
import {
  StatementSection,
  type StatementLine,
} from "@/components/financial/StatementSection";
import {
  BalanceMonthlyTable,
  type BalanceMonthlyRow,
} from "@/components/financial/BalanceMonthlyTable";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

type View = "annual" | "monthly" | "current-month";

export default async function BalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);
  const view: View =
    sp.view === "monthly"
      ? "monthly"
      : sp.view === "current-month"
        ? "current-month"
        : "annual";

  const supabase = createDataClient();

  const yearStart = `${period.to.slice(0, 4)}-01-01`;
  const [bsTxns, ytd] = await Promise.all([
    fetchBalanceSheetData(supabase, { entity }),
    fetchReportData(supabase, {
      entity,
      from: yearStart,
      to: period.to,
    }),
  ]);

  const entityLabel = entity === "all" ? "All entities" : entity;

  if (view === "monthly") {
    const year = Number(period.to.slice(0, 4));
    const months = monthlyBuckets(year).map((m) => ({
      key: m.key.slice(5, 7),
      yyyymm: m.key,
      to: m.to,
      label: m.label,
    }));
    return (
      <SnapshotTableView
        view="monthly"
        bsTxns={bsTxns}
        ytdTxns={ytd.txns}
        months={months}
        subtitle={`FY ${year} · Month-end balances · ${entityLabel}`}
      />
    );
  }

  if (view === "current-month") {
    const cm = resolvePeriod({ key: "month" });
    const months = [
      {
        key: cm.key.slice(5, 7) || "cm",
        yyyymm: cm.to.slice(0, 7),
        to: cm.to,
        label: cm.label,
      },
    ];
    return (
      <SnapshotTableView
        view="current-month"
        bsTxns={bsTxns}
        ytdTxns={ytd.txns}
        months={months}
        subtitle={`As of ${cm.to} · ${entityLabel}`}
      />
    );
  }

  // Annual (default): legacy single-snapshot card layout, cumulative across
  // all history. Retained earnings uses the YTD revenue/expense net.
  const groups = groupBalanceByAccount(bsTxns);

  function lineFor(
    type: "asset" | "liability" | "equity",
  ): { lines: StatementLine[]; total: number } {
    const filtered = groups.filter((g) => g.account?.account_type === type);
    const lines: StatementLine[] = filtered
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .map((g) => ({
        label: `${g.account?.account_code} · ${g.account?.account_name}`,
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

  let revenueTotal = 0;
  let expenseTotal = 0;
  for (const t of ytd.txns) {
    if (!t.accounts) continue;
    if (t.accounts.account_type === "revenue") revenueTotal += Number(t.amount);
    else if (t.accounts.account_type === "expense") expenseTotal += -Number(t.amount);
  }
  const retainedEarnings = revenueTotal - expenseTotal;

  const assets = lineFor("asset");
  const liabilities = lineFor("liability");
  const equity = lineFor("equity");

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
      subtitle={`As of ${period.to} · ${entityLabel}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <ViewToggle current="annual" />
      </div>

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

type SnapshotMonth = {
  key: string;     // short column key
  yyyymm: string;  // "YYYY-MM" for lookups against the snapshot map
  to: string;      // last day of month "YYYY-MM-DD"
  label: string;
};

function SnapshotTableView({
  view,
  bsTxns,
  ytdTxns,
  months,
  subtitle,
}: {
  view: "monthly" | "current-month";
  bsTxns: Awaited<ReturnType<typeof fetchBalanceSheetData>>;
  ytdTxns: Awaited<ReturnType<typeof fetchReportData>>["txns"];
  months: SnapshotMonth[];
  subtitle: string;
}) {
  const snapshotMonths = months.map((m) => ({ key: m.yyyymm, to: m.to }));
  const perAccount = monthlyBalanceSnapshots(bsTxns, snapshotMonths);

  // YTD revenue/expense, bucketed by month, used to project retained earnings
  // at each snapshot's month-end. For the current-month view this collapses
  // to a single running total through the end of that month.
  const year = months[0]?.to.slice(0, 4) ?? "";
  const revByMonth = new Map<string, number>();
  const expByMonth = new Map<string, number>();
  for (const t of ytdTxns) {
    if (!t.accounts || !t.acc_date) continue;
    if (t.acc_date.slice(0, 4) !== year) continue;
    const mk = t.acc_date.slice(0, 7);
    const amt = Number(t.amount ?? 0);
    if (t.accounts.account_type === "revenue") {
      revByMonth.set(mk, (revByMonth.get(mk) ?? 0) + amt);
    } else if (t.accounts.account_type === "expense") {
      expByMonth.set(mk, (expByMonth.get(mk) ?? 0) + -amt);
    }
  }

  function buildSection(
    type: "asset" | "liability" | "equity",
  ): { rows: BalanceMonthlyRow[]; totals: Record<string, number> } {
    const entries = [...perAccount.values()].filter(
      (e) => e.account?.account_type === type,
    );
    const lastMonthKey = months[months.length - 1]?.yyyymm ?? "";
    entries.sort((a, b) => {
      const av = Math.abs(a.byMonth.get(lastMonthKey) ?? 0);
      const bv = Math.abs(b.byMonth.get(lastMonthKey) ?? 0);
      return bv - av;
    });

    const totals: Record<string, number> = {};
    for (const m of months) totals[m.key] = 0;

    const rows: BalanceMonthlyRow[] = entries.map((e) => {
      const values: Record<string, number> = {};
      for (const m of months) {
        const raw = e.byMonth.get(m.yyyymm) ?? 0;
        const v = type === "asset" ? -raw : raw;
        values[m.key] = v;
        totals[m.key] += v;
      }
      return {
        kind: "account",
        label: `${e.account?.account_code} · ${e.account?.account_name}`,
        values,
      };
    });

    return { rows, totals };
  }

  const assets = buildSection("asset");
  const liabilities = buildSection("liability");
  const equity = buildSection("equity");

  // Retained earnings per column = YTD net income through that column's month.
  // For the monthly view this is a running total across the year; for the
  // current-month view it's a single value summed Jan..currentMonth.
  const retainedByMonth: Record<string, number> = {};
  for (const m of months) {
    const targetMonth = m.yyyymm;
    let rev = 0;
    let exp = 0;
    for (const [mk, v] of revByMonth) if (mk <= targetMonth) rev += v;
    for (const [mk, v] of expByMonth) if (mk <= targetMonth) exp += v;
    retainedByMonth[m.key] = rev - exp;
  }
  for (const m of months) {
    equity.totals[m.key] += retainedByMonth[m.key];
  }

  const totalLEByMonth: Record<string, number> = {};
  const diffByMonth: Record<string, number> = {};
  for (const m of months) {
    totalLEByMonth[m.key] = liabilities.totals[m.key] + equity.totals[m.key];
    diffByMonth[m.key] = assets.totals[m.key] - totalLEByMonth[m.key];
  }

  // % column denominator: total assets at that month-end.
  const denomByMonth: Record<string, number> = {};
  for (const m of months) denomByMonth[m.key] = assets.totals[m.key];

  const rows: BalanceMonthlyRow[] = [
    { kind: "section", label: "Assets" },
    ...assets.rows,
    {
      kind: "total",
      label: "Total assets",
      values: assets.totals,
      emphasis: "primary",
    },
    { kind: "section", label: "Liabilities" },
    ...liabilities.rows,
    {
      kind: "total",
      label: "Total liabilities",
      values: liabilities.totals,
      emphasis: "primary",
    },
    { kind: "section", label: "Equity" },
    ...equity.rows,
    {
      kind: "account",
      label: "Retained earnings (YTD net income)",
      values: retainedByMonth,
    },
    {
      kind: "total",
      label: "Total equity",
      values: equity.totals,
      emphasis: "primary",
    },
    {
      kind: "total",
      label: "Liabilities + Equity",
      values: totalLEByMonth,
      emphasis: "highlight",
    },
    {
      kind: "total",
      label: "Assets − (Liab + Equity)",
      values: diffByMonth,
      emphasis: "highlight",
    },
  ];

  const displayMonths = months.map((m) => ({ key: m.key, label: m.label }));

  return (
    <PageShell page="balance" title="Balance Sheet" subtitle={subtitle}>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <ViewToggle current={view} />
      </div>
      <BalanceMonthlyTable
        months={displayMonths}
        rows={rows}
        denomByMonth={denomByMonth}
      />
    </PageShell>
  );
}

function ViewToggle({ current }: { current: View }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-[11px]">
      <Link
        href="?view=annual"
        className={cn(
          "px-2 py-1",
          current === "annual"
            ? "bg-info-soft text-info"
            : "text-muted hover:bg-surface-2",
        )}
      >
        Annual
      </Link>
      <Link
        href="?view=monthly"
        className={cn(
          "border-l border-border px-2 py-1",
          current === "monthly"
            ? "bg-info-soft text-info"
            : "text-muted hover:bg-surface-2",
        )}
      >
        Monthly
      </Link>
      <Link
        href="?view=current-month"
        className={cn(
          "border-l border-border px-2 py-1",
          current === "current-month"
            ? "bg-info-soft text-info"
            : "text-muted hover:bg-surface-2",
        )}
      >
        Current Month
      </Link>
    </div>
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
