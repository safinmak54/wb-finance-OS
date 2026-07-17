import Link from "next/link";
import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  fetchBalanceSheetData,
  fetchReportData,
  groupBalanceByAccount,
  monthlyBalanceSnapshots,
} from "@/lib/queries/reports";
import { listAccounts } from "@/lib/queries/accounts";
import type { Account } from "@/lib/supabase/types";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import {
  periodFromSearchParams,
  monthlyBuckets,
  resolvePeriod,
} from "@/lib/period";
import {
  BalanceMonthlyTable,
  type BalanceMonthlyRow,
} from "@/components/financial/BalanceMonthlyTable";
import { CategorizedBalanceSheet } from "@/components/financial/CategorizedBalanceSheet";
import { buildExactBalanceSheet } from "@/lib/balance/structure";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

type View = "annual" | "monthly" | "current-month";

type BalanceAccountMeta = Pick<
  Account,
  "id" | "account_code" | "account_name" | "account_type"
>;

/**
 * Build the full set of accounts to render on the balance sheet. Like the
 * P&L (which seeds rows from `listAccounts`), every active account is shown
 * even when it has no transactions, so empty asset/liability/equity rows
 * still appear. The union with transaction-bearing accounts keeps any
 * account that has a balance but is inactive from being dropped.
 */
function mergeBalanceAccounts(
  active: readonly Account[],
  txnAccounts: ReadonlyArray<BalanceAccountMeta | null>,
): BalanceAccountMeta[] {
  const byId = new Map<string, BalanceAccountMeta>();
  for (const a of active) {
    byId.set(a.id, {
      id: a.id,
      account_code: a.account_code,
      account_name: a.account_name,
      account_type: a.account_type,
    });
  }
  for (const a of txnAccounts) {
    if (!a || byId.has(a.id)) continue;
    byId.set(a.id, {
      id: a.id,
      account_code: a.account_code,
      account_name: a.account_name,
      account_type: a.account_type,
    });
  }
  return [...byId.values()];
}

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
  const [bsTxns, ytd, accounts] = await Promise.all([
    fetchBalanceSheetData(supabase, { entity }),
    fetchReportData(supabase, {
      entity,
      from: yearStart,
      to: period.to,
    }),
    listAccounts(supabase, { activeOnly: true }),
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
        accounts={accounts}
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
        accounts={accounts}
        months={months}
        subtitle={`As of ${cm.to} · ${entityLabel}`}
      />
    );
  }

  // Annual (default): classic two-column balance sheet, cumulative across all
  // history. Accounts are grouped into management categories (Cash, A/R by
  // payment method, A/P — COGS/Marketing/Salaries/Others, …); Net Income uses
  // the YTD revenue/expense net as a dedicated equity line.
  const groups = groupBalanceByAccount(bsTxns);
  const totalsById = new Map<string, number>();
  for (const g of groups) {
    if (g.account?.id) totalsById.set(g.account.id, g.total);
  }
  // Include every active account (plus any with a balance) so the category
  // subtotals tie out even for accounts with no current-period activity.
  const balanceAccounts = mergeBalanceAccounts(
    accounts,
    groups.map((g) => g.account),
  );

  let revenueTotal = 0;
  let expenseTotal = 0;
  for (const t of ytd.txns) {
    if (!t.accounts) continue;
    if (t.accounts.account_type === "revenue") revenueTotal += Number(t.amount);
    else if (t.accounts.account_type === "expense") expenseTotal += -Number(t.amount);
  }
  const netIncome = revenueTotal - expenseTotal;

  // Owner's Distribution is a manually maintained equity figure entered on the
  // sheet, persisted in cash_balances under a reserved key (no GL posting yet).
  // Cumulative magnitude per entity; the consolidated view sums all entities.
  let distQuery = supabase
    .from("cash_balances")
    .select("value")
    .eq("col_key", "owner_distribution");
  if (entity !== "all") distQuery = distQuery.eq("entity", entity);
  const { data: distRows } = await distQuery;
  const ownerDistribution = (distRows ?? []).reduce(
    (s: number, r: { value: number | null }) => s + Math.abs(Number(r.value ?? 0)),
    0,
  );

  const sheet = buildExactBalanceSheet(
    balanceAccounts,
    totalsById,
    netIncome,
    ownerDistribution,
  );
  const codeToId: Record<string, string> = {};
  for (const a of balanceAccounts) codeToId[a.account_code] = a.id;

  return (
    <PageShell
      page="balance"
      title="Balance Sheet"
      subtitle={`As of ${period.to} · ${entityLabel}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <ViewToggle current="annual" />
      </div>

      <CategorizedBalanceSheet
        sheet={sheet}
        codeToId={codeToId}
        entity={entity}
        ownerDistribution={ownerDistribution}
        canEditDistribution={entity !== "all"}
        equityExclDistribution={sheet.totalEquity + ownerDistribution}
      />
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
  accounts,
  months,
  subtitle,
}: {
  view: "monthly" | "current-month";
  bsTxns: Awaited<ReturnType<typeof fetchBalanceSheetData>>;
  ytdTxns: Awaited<ReturnType<typeof fetchReportData>>["txns"];
  accounts: Account[];
  months: SnapshotMonth[];
  subtitle: string;
}) {
  const snapshotMonths = months.map((m) => ({ key: m.yyyymm, to: m.to }));
  const perAccount = monthlyBalanceSnapshots(bsTxns, snapshotMonths);
  // Render every active account (plus any with activity), even at zero, so
  // empty asset/liability/equity rows still appear — matching the P&L.
  const balanceAccounts = mergeBalanceAccounts(
    accounts,
    [...perAccount.values()].map((e) => e.account),
  );

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
    const lastMonthKey = months[months.length - 1]?.yyyymm ?? "";
    const sectionAccounts = balanceAccounts
      .filter((a) => a.account_type === type)
      .sort((a, b) => {
        const av = Math.abs(perAccount.get(a.id)?.byMonth.get(lastMonthKey) ?? 0);
        const bv = Math.abs(perAccount.get(b.id)?.byMonth.get(lastMonthKey) ?? 0);
        return bv - av;
      });

    const totals: Record<string, number> = {};
    for (const m of months) totals[m.key] = 0;

    const rows: BalanceMonthlyRow[] = sectionAccounts.map((a) => {
      const byMonth = perAccount.get(a.id)?.byMonth;
      const values: Record<string, number> = {};
      for (const m of months) {
        const raw = byMonth?.get(m.yyyymm) ?? 0;
        const v = type === "asset" ? -raw : raw;
        values[m.key] = v;
        totals[m.key] += v;
      }
      return {
        kind: "account",
        label: `${a.account_code} · ${a.account_name}`,
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

