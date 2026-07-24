import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  fetchPnlReportData,
  groupByAccountAndEntity,
  type AccountAggregate,
} from "@/lib/queries/reports";
import { listAccounts } from "@/lib/queries/accounts";
import {
  listPnlManualEntries,
  mergeManualEntriesIntoAggregates,
  API_SOURCED_ACCOUNT_CODES,
} from "@/lib/queries/pnl-manual";
import {
  periodFromSearchParams,
  resolvePeriod,
  yearRange,
  monthlyBuckets,
  recentMonths,
  currentMonthKey,
} from "@/lib/period";
import {
  PNL_ENTITY_COLUMNS,
  type EntityCode,
} from "@/lib/entities";
import type { Account } from "@/lib/supabase/types";
import { CODE_TO_SUBTYPE, HIDDEN_ACCOUNT_CODES } from "@/lib/pnl/structure";
import { PnlClient, type PnlDocument, type PnlRow } from "./PnlClient";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Income Statement structure — Chart of Accounts v2 (see migration
// 0020_chart_of_accounts_v2.sql).
//
// Unlike the previous subtype-bucket approach, each line item is declared
// EXPLICITLY by account code + name. This lets the statement render a row for
// every account the spec expects even when that account does not yet exist in
// the ledger: the value shows "N/A" and clicking it opens a modal explaining
// the account is absent from the chart of accounts.
//
//   - `section` blocks list their expected accounts. `sign` converts a stored
//     raw amount into a display-positive magnitude (revenue is credit-normal
//     → +1; contra-revenue and every expense is debit-normal → -1).
//   - `subtotal` blocks are computed rows: sum of `add` blocks minus `sub`
//     blocks (both referencing section/subtotal keys defined earlier). Because
//     every section already displays a positive magnitude, deductions live in
//     `sub`.
// ---------------------------------------------------------------------------
type IsAccountSpec = { code: string; name: string };
type IsBlock =
  | {
      kind: "section";
      key: string;
      label: string;
      sign: 1 | -1;
      accounts: IsAccountSpec[];
    }
  | {
      kind: "subtotal";
      key: string;
      label: string;
      emphasis?: "primary" | "highlight";
      add: string[];
      sub: string[];
    };

const IS_STRUCTURE: IsBlock[] = [
  {
    kind: "section",
    key: "gross_revenue",
    label: "Gross Revenue",
    sign: 1,
    accounts: [
      { code: "4001", name: "Gross Revenue - Stripe" },
      { code: "4002", name: "Gross Revenue - PayPal" },
      { code: "4003", name: "Gross Revenue - Direct" },
    ],
  },
  {
    kind: "section",
    key: "sales_return",
    label: "Sales Return",
    sign: -1,
    accounts: [
      { code: "4011", name: "Sales Return - Stripe" },
      { code: "4012", name: "Sales Return - Paypal" },
      { code: "4013", name: "Sales Return - Direct" },
    ],
  },
  {
    kind: "subtotal",
    key: "gr_excl_ref",
    label: "Gross Revenue excl. Ref",
    add: ["gross_revenue"],
    sub: ["sales_return"],
  },
  {
    kind: "section",
    key: "platform_fee",
    label: "Platform Fee",
    sign: -1,
    accounts: [
      { code: "4021", name: "Platform Fee - Stripe" },
      { code: "4022", name: "Platform Fee - PayPal" },
      { code: "4023", name: "Platform Fee - Other" },
    ],
  },
  {
    kind: "section",
    key: "sales_tax",
    label: "Sales Tax",
    sign: -1,
    accounts: [{ code: "4031", name: "Sales Tax" }],
  },
  {
    kind: "subtotal",
    key: "net_sales",
    label: "Net Sales",
    emphasis: "primary",
    add: ["gr_excl_ref"],
    sub: ["platform_fee", "sales_tax"],
  },
  {
    kind: "section",
    key: "cogs",
    label: "Cost of Goods Sold",
    sign: -1,
    accounts: [{ code: "5001", name: "COGS - WB+SP" }],
  },
  {
    kind: "subtotal",
    key: "gross_profit",
    label: "Gross Profit",
    emphasis: "primary",
    add: ["net_sales"],
    sub: ["cogs"],
  },
  {
    kind: "section",
    key: "marketing",
    label: "Marketing",
    sign: -1,
    accounts: [
      { code: "5011", name: "Google Ads" },
      { code: "5012", name: "Meta Ads" },
      { code: "5013", name: "Bing Ads" },
      { code: "5014", name: "ASI Ads" },
      { code: "5015", name: "Sage Ads" },
      { code: "5017", name: "Ad Agency Fee" },
    ],
  },
  {
    kind: "subtotal",
    key: "gp_incl_mktg",
    label: "Gross Profit incl. Marketing Cost",
    emphasis: "primary",
    add: ["gross_profit"],
    sub: ["marketing"],
  },
  {
    kind: "section",
    key: "compensation",
    label: "Compensation",
    sign: -1,
    accounts: [
      { code: "6001", name: "Wages — W2" },
      { code: "6002", name: "Contractor — 1099" },
      { code: "6003", name: "Payroll Tax Expense" },
    ],
  },
  {
    kind: "section",
    key: "util_office",
    label: "Utilities & Office Expenses",
    sign: -1,
    accounts: [
      { code: "7001", name: "Rent expense" },
      { code: "7002", name: "Utilities" },
      { code: "7003", name: "Office supplies" },
      { code: "7004", name: "Repairs and maintenance" },
      { code: "7005", name: "Telephone and internet" },
      { code: "7006", name: "Mis Exp" },
    ],
  },
  {
    kind: "section",
    key: "software_subs",
    label: "Software, Dues & Subscriptions",
    sign: -1,
    accounts: [
      { code: "7007", name: "Computers and Software" },
      { code: "7008", name: "Subscriptions" },
      { code: "7009", name: "Domain Fee" },
      { code: "7010", name: "Contractor- Other (Upwork)" },
    ],
  },
  {
    kind: "section",
    key: "other_fees",
    label: "Other Fees",
    sign: -1,
    accounts: [
      { code: "7011", name: "Professional Fee" },
      { code: "7012", name: "Bank fees" },
      { code: "7013", name: "Management Fee - One Ops" },
    ],
  },
  {
    kind: "subtotal",
    key: "other_opex",
    label: "Other Operating Expense",
    emphasis: "primary",
    add: ["compensation", "util_office", "software_subs", "other_fees"],
    sub: [],
  },
  {
    kind: "subtotal",
    key: "net_profit",
    label: "Net Profit",
    emphasis: "highlight",
    add: ["gp_incl_mktg"],
    sub: ["other_opex"],
  },
];

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const view: "annual" | "monthly" | "month" =
    sp.view === "monthly"
      ? "monthly"
      : sp.view === "month"
        ? "month"
        : "annual";

  // "Per Month" view: a single user-selected month (defaults to the current
  // month). Options going back two years are offered in the picker.
  const monthOptions = recentMonths(24);
  const selectedMonth =
    typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month)
      ? sp.month
      : currentMonthKey();

  // Monthly view is scoped to one entity column at a time (picker in the UI).
  // Annual view shows all entity columns side by side.
  const entityColKey = typeof sp.entityCol === "string" ? sp.entityCol : "ALL";
  const monthlyEntityCol =
    PNL_ENTITY_COLUMNS.find((c) => c.key === entityColKey) ??
    PNL_ENTITY_COLUMNS[0];

  // This page always pulls "all entities" data — we slice into entity-column
  // buckets in memory.
  const year = Number(period.from.slice(0, 4));
  const range =
    view === "monthly"
      ? yearRange(year)
      : view === "month"
        ? resolvePeriod({ key: selectedMonth })
        : period;
  const months = view === "monthly" ? monthlyBuckets(year) : [];

  const supabase = createDataClient();
  const accounts = (await listAccounts(supabase, { activeOnly: true })).filter(
    (a) => !HIDDEN_ACCOUNT_CODES.has(a.account_code),
  );
  // P&L reads from `transactions_pnl` — a view over `transactions` that
  // dedupes Admin-API rows down to the latest snapshot per (period,
  // source). All P&L numbers come from rows persisted in `transactions`
  // (no separate API-direct fetch path).
  const [report, manualEntries] = await Promise.all([
    fetchPnlReportData(supabase, {
      entity: "all",
      from: range.from,
      to: range.to,
    }),
    listPnlManualEntries(supabase, { from: range.from, to: range.to }),
  ]);
  const aggregates = groupByAccountAndEntity(report.txns);

  // Fold manual entries into the same aggregate Map. Manual entries can
  // only target non-API-sourced accounts (enforced server-side in the
  // upsert action).
  mergeManualEntriesIntoAggregates(
    aggregates,
    manualEntries,
    accounts,
    CODE_TO_SUBTYPE,
  );

  // Look up the ledger account backing each spec line by its code. A code
  // absent here renders as an "N/A" (missing) row.
  const accountsByCode = new Map<string, Account>();
  for (const a of accounts) accountsByCode.set(a.account_code, a);

  // ---- Value columns -----------------------------------------------------
  // A column carries enough context to (a) compute its value from the
  // aggregates, and (b) drive a drill-down query (entityCodes + date range).
  type Column = {
    key: string;
    label: string;
    entityCodes: readonly EntityCode[];
    range: { from: string; to: string };
    monthKey?: string; // present only for monthly columns
  };

  let valueColumns: Column[];
  if (view === "monthly") {
    valueColumns = months.map((m) => ({
      key: m.key,
      label: m.label,
      entityCodes: monthlyEntityCol.entityCodes,
      range: { from: m.from, to: m.to },
      monthKey: m.key,
    }));
    valueColumns.push({
      key: "TOTAL",
      label: "Total",
      entityCodes: monthlyEntityCol.entityCodes,
      range: { from: range.from, to: range.to },
    });
  } else {
    // annual + per-month both lay out as one column per entity group.
    valueColumns = PNL_ENTITY_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      entityCodes: c.entityCodes,
      range: { from: range.from, to: range.to },
    }));
  }

  // Raw (unsigned) aggregate value for one account in one column.
  function rawFor(agg: AccountAggregate | undefined, col: Column): number {
    if (!agg) return 0;
    let raw = 0;
    if (col.monthKey) {
      for (const code of col.entityCodes) {
        const m = agg.byEntityMonth.get(code);
        if (m) raw += m.get(col.monthKey) ?? 0;
      }
    } else {
      for (const code of col.entityCodes) {
        raw += agg.byEntity.get(code) ?? 0;
      }
    }
    return raw;
  }

  function emptyRecord(): Record<string, number> {
    const r: Record<string, number> = {};
    for (const c of valueColumns) r[c.key] = 0;
    return r;
  }

  // Per-block per-column totals and the (existing) account ids each block
  // covers, for drill-down. Both sections and subtotals are recorded so a
  // subtotal can union the ids of the blocks it references.
  const blockValues = new Map<string, Record<string, number>>();
  const blockAccountIds = new Map<string, string[]>();

  const rows: PnlRow[] = [];

  for (const block of IS_STRUCTURE) {
    if (block.kind === "section") {
      const total = emptyRecord();
      const existingIds: string[] = [];

      // Section label + subtotal row on top. `total`/`existingIds` are held
      // by reference and populated by the account loop below.
      rows.push({
        kind: "section",
        sectionId: block.key,
        label: block.label,
        total,
        accountIds: existingIds,
      });

      for (const spec of block.accounts) {
        const acct = accountsByCode.get(spec.code);
        const label = `${spec.code} · ${spec.name}`;
        if (!acct) {
          rows.push({
            kind: "account",
            sectionId: block.key,
            accountId: null,
            accountCode: spec.code,
            missing: true,
            manualEditable: false,
            label,
            values: emptyRecord(),
          });
          continue;
        }
        const agg = aggregates.get(acct.id);
        const values = emptyRecord();
        for (const c of valueColumns) {
          const v = rawFor(agg, c) * block.sign;
          values[c.key] = v;
          total[c.key] += v;
        }
        existingIds.push(acct.id);
        rows.push({
          kind: "account",
          sectionId: block.key,
          accountId: acct.id,
          accountCode: spec.code,
          missing: false,
          manualEditable: !API_SOURCED_ACCOUNT_CODES.has(spec.code),
          label,
          values,
        });
      }

      blockValues.set(block.key, total);
      blockAccountIds.set(block.key, existingIds);
    } else {
      // subtotal
      const total = emptyRecord();
      for (const c of valueColumns) {
        let v = 0;
        for (const k of block.add) v += blockValues.get(k)?.[c.key] ?? 0;
        for (const k of block.sub) v -= blockValues.get(k)?.[c.key] ?? 0;
        total[c.key] = v;
      }
      const memberIds = new Set<string>();
      for (const k of [...block.add, ...block.sub]) {
        for (const id of blockAccountIds.get(k) ?? []) memberIds.add(id);
      }
      blockValues.set(block.key, total);
      blockAccountIds.set(block.key, [...memberIds]);
      rows.push({
        kind: "computed",
        label: block.label,
        values: total,
        emphasis: block.emphasis,
        accountIds: [...memberIds],
      });
    }
  }

  // Per-column denominator for % display: Gross Revenue (top-line sales
  // before returns/fees).
  const denomByCol: Record<string, number> = {};
  const grossRevenueTotals = blockValues.get("gross_revenue");
  for (const c of valueColumns) {
    denomByCol[c.key] = grossRevenueTotals?.[c.key] ?? 0;
  }

  // Year-to-date range for the "Sync YTD from Admin API" button: Jan 1 of
  // the current calendar year through today. This drives the same Admin API
  // refresh the Cashbook page uses, scoped to YTD.
  const today = new Date().toISOString().slice(0, 10);
  const ytd = { from: `${today.slice(0, 4)}-01-01`, to: today };

  const document: PnlDocument = {
    view,
    ytd,
    valueColumns: valueColumns.map((c) => ({
      key: c.key,
      label: c.label,
      entityCodes: [...c.entityCodes],
      range: c.range,
    })),
    denomByCol,
    rows,
    range,
    entityCol: view === "monthly" ? monthlyEntityCol.key : null,
    entityColOptions: PNL_ENTITY_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
    })),
    selectedMonth: view === "month" ? selectedMonth : null,
    monthOptions,
    accounts: accounts.map((a) => ({
      id: a.id,
      code: a.account_code,
      name: a.account_name,
    })),
  };

  const subtitleSuffix =
    view === "monthly"
      ? `FY ${year} · ${monthlyEntityCol.label}`
      : view === "month"
        ? `${range.label} · All entity columns`
        : `${period.label} · All entity columns`;

  return (
    <PageShell page="pnl" title="Income Statement" subtitle={subtitleSuffix}>
      <PnlClient doc={document} />
    </PageShell>
  );
}
