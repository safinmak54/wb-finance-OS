import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  fetchBalanceSheetData,
  fetchReportData,
  groupBalanceByAccount,
} from "@/lib/queries/reports";
import { listAccounts } from "@/lib/queries/accounts";
import type { Account } from "@/lib/supabase/types";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import { CategorizedBalanceSheet } from "@/components/financial/CategorizedBalanceSheet";
import { BalanceFilters } from "./BalanceFilters";
import { buildExactBalanceSheet } from "@/lib/balance/structure";

export const dynamic = "force-dynamic";

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

/**
 * Balance Sheet — a single annual (categorized two-column) view driven by a
 * Start → End date range (`?period=custom&from=…&to=…`, default YTD).
 *
 * The sheet is a point-in-time snapshot: asset/liability/equity balances are
 * the cumulative sum of every transaction dated on/before the **End** date.
 * The **Start** date scopes only the current-period Net Income line
 * (revenue − expense within [Start, End]) — accumulated prior earnings live in
 * Retained Earnings. Accounts are grouped into the management categories the
 * COO reads via `buildExactBalanceSheet`.
 */
export default async function BalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = createDataClient();

  const [bsTxns, periodReport, accounts] = await Promise.all([
    // Balances: cumulative through the end date.
    fetchBalanceSheetData(supabase, { entity, to: period.to }),
    // Net Income: revenue/expense within the [Start, End] window.
    fetchReportData(supabase, {
      entity,
      from: period.from,
      to: period.to,
    }),
    listAccounts(supabase, { activeOnly: true }),
  ]);

  const entityLabel = entity === "all" ? "All entities" : entity;

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
  for (const t of periodReport.txns) {
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
      <div className="mb-3">
        <BalanceFilters from={period.from} to={period.to} />
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
