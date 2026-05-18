import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import type { AccountAggregate } from "@/lib/queries/reports";
import { buildPnlAggregatesFromCashbook } from "@/lib/queries/cashbook-pnl";
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
} from "@/lib/period";
import {
  PNL_ENTITY_COLUMNS,
  type EntityCode,
} from "@/lib/entities";
import type { Account } from "@/lib/supabase/types";
import { PnlClient, type PnlDocument, type PnlRow } from "./PnlClient";

export const dynamic = "force-dynamic";

type Subtype =
  | "gross_revenue"
  | "sales_return"
  | "platform_fee"
  | "cogs"
  | "sales_tax"
  | "marketing"
  | "labour"
  | "opex"
  | "distribution";

// P&L structure. Outer entries are "groups" (Column A label). Inner
// entries are "sections" (Column B label, collapsible). Rendering
// order is preserved here.
const STRUCTURE: Array<{
  key: string;
  label: string;
  sections: Array<{ key: string; label: string; subtype: Subtype }>;
}> = [
  {
    key: "gross_revenue",
    label: "Gross Revenue",
    sections: [
      { key: "revenue", label: "Revenue", subtype: "gross_revenue" },
      { key: "sales_return", label: "Sales Return", subtype: "sales_return" },
      { key: "platform_fee", label: "Platform Fee", subtype: "platform_fee" },
    ],
  },
  {
    key: "cogs",
    label: "Cost of Goods Sold",
    sections: [
      { key: "cogs", label: "COGS", subtype: "cogs" },
      { key: "sales_tax", label: "Sales Tax", subtype: "sales_tax" },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    sections: [
      { key: "ad_spends", label: "Ad Spends & Agency", subtype: "marketing" },
    ],
  },
  {
    key: "opex",
    label: "Operating Expenses",
    sections: [
      { key: "labour", label: "Labour Cost", subtype: "labour" },
      { key: "other_opex", label: "Other Operating Expenses", subtype: "opex" },
    ],
  },
  {
    key: "distribution",
    label: "Distribution",
    sections: [
      { key: "distribution", label: "Distribution", subtype: "distribution" },
    ],
  },
];

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const view: "annual" | "monthly" | "current-month" =
    sp.view === "monthly"
      ? "monthly"
      : sp.view === "current-month"
        ? "current-month"
        : "annual";

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
      : view === "current-month"
        ? resolvePeriod({ key: "month" })
        : period;
  const months = view === "monthly" ? monthlyBuckets(year) : [];

  const supabase = createDataClient();
  const accounts = await listAccounts(supabase, { activeOnly: true });
  // "For now" mode: P&L numbers come straight from cashbook_snapshots
  // (Admin API) via the same field-to-account mapping we use for journal
  // generation. Bypasses the transactions/journals roundtrip entirely.
  const [cb, manualEntries] = await Promise.all([
    buildPnlAggregatesFromCashbook(supabase, { range, accounts }),
    listPnlManualEntries(supabase, { from: range.from, to: range.to }),
  ]);
  const aggregates = cb.aggregates;

  // Hardcoded account-code → P&L subtype mapping.
  const CODE_TO_SUBTYPE: Record<string, Subtype> = {};
  for (const c of ["4040", "4050", "4060", "4070", "4080"]) {
    CODE_TO_SUBTYPE[c] = "gross_revenue";
  }
  for (const c of ["4045", "4055", "4065"]) {
    CODE_TO_SUBTYPE[c] = "sales_return";
  }
  for (const c of ["4075", "4076"]) {
    CODE_TO_SUBTYPE[c] = "platform_fee";
  }
  for (const c of ["5000", "5005"]) {
    CODE_TO_SUBTYPE[c] = "cogs";
  }
  for (const c of ["5040"]) {
    CODE_TO_SUBTYPE[c] = "sales_tax";
  }
  for (const c of ["6000", "6001", "6002", "6003", "6004", "6030"]) {
    CODE_TO_SUBTYPE[c] = "marketing";
  }
  for (const c of ["6100", "6110", "6112", "6120", "6121"]) {
    CODE_TO_SUBTYPE[c] = "labour";
  }
  for (const c of [
    "6200",
    "6300",
    "6400",
    "6450",
    "6600",
    "6615",
    "6620",
    "6640",
    "6646",
    "6648",
  ]) {
    CODE_TO_SUBTYPE[c] = "opex";
  }

  // Fold manual entries into the same aggregate Map. Manual entries can
  // only target non-API-sourced accounts (enforced server-side in the
  // upsert action).
  mergeManualEntriesIntoAggregates(
    aggregates,
    manualEntries,
    accounts,
    CODE_TO_SUBTYPE,
  );

  const accountsBySubtype = new Map<Subtype, Account[]>();
  for (const a of accounts) {
    const k = CODE_TO_SUBTYPE[a.account_code];
    if (!k) continue;
    if (!accountsBySubtype.has(k)) accountsBySubtype.set(k, []);
    accountsBySubtype.get(k)!.push(a);
  }
  for (const arr of accountsBySubtype.values()) {
    arr.sort((a, b) => a.account_code.localeCompare(b.account_code));
  }

  function signFor(a: Account): 1 | -1 {
    // Sales Return accounts are revenue-type but debit-normal — stored
    // amounts are negative. Flip so the section shows a positive figure,
    // letting `totalRevenue = revenue − salesReturn − platformFee` work.
    const subtype = CODE_TO_SUBTYPE[a.account_code];
    if (subtype === "sales_return") return -1;
    if (a.account_type === "revenue") return 1;
    if (a.account_type === "expense") return -1;
    if (a.account_type === "equity") return -1;
    return 1;
  }

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
    // annual + current-month both lay out as one column per entity group.
    valueColumns = PNL_ENTITY_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      entityCodes: c.entityCodes,
      range: { from: range.from, to: range.to },
    }));
  }

  function valueFor(
    agg: AccountAggregate | undefined,
    account: Account,
    col: Column,
  ): number {
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
    return raw * signFor(account);
  }

  function emptyRecord(): Record<string, number> {
    const r: Record<string, number> = {};
    for (const c of valueColumns) r[c.key] = 0;
    return r;
  }

  function valuesForAccount(a: Account): Record<string, number> {
    const agg = aggregates.get(a.id);
    const r = emptyRecord();
    for (const c of valueColumns) r[c.key] = valueFor(agg, a, c);
    return r;
  }

  // Section totals + their underlying accountIds for drill-down.
  const sectionTotals = new Map<string, Record<string, number>>();
  const sectionAccountRows = new Map<
    string,
    Array<{
      accountId: string;
      accountCode: string;
      manualEditable: boolean;
      label: string;
      values: Record<string, number>;
    }>
  >();
  const sectionAccountIds = new Map<string, string[]>();

  for (const grp of STRUCTURE) {
    for (const sec of grp.sections) {
      const accountsForSection = accountsBySubtype.get(sec.subtype) ?? [];
      const rows = accountsForSection.map((a) => ({
        accountId: a.id,
        accountCode: a.account_code,
        manualEditable: !API_SOURCED_ACCOUNT_CODES.has(a.account_code),
        label: `${a.account_code} · ${a.account_name}`,
        values: valuesForAccount(a),
      }));
      const total = emptyRecord();
      for (const c of valueColumns) {
        total[c.key] = rows.reduce((s, r) => s + r.values[c.key], 0);
      }
      const sectionId = `${grp.key}/${sec.key}`;
      sectionTotals.set(sectionId, total);
      sectionAccountRows.set(sectionId, rows);
      sectionAccountIds.set(
        sectionId,
        accountsForSection.map((a) => a.id),
      );
    }
  }

  function st(grpKey: string, secKey: string, colKey: string): number {
    return sectionTotals.get(`${grpKey}/${secKey}`)?.[colKey] ?? 0;
  }

  function ids(...sectionIds: string[]): string[] {
    const out: string[] = [];
    for (const id of sectionIds) {
      for (const a of sectionAccountIds.get(id) ?? []) out.push(a);
    }
    return out;
  }

  function computeRow(fn: (colKey: string) => number): Record<string, number> {
    const r = emptyRecord();
    for (const c of valueColumns) r[c.key] = fn(c.key);
    return r;
  }

  const totalRevenue = computeRow(
    (k) =>
      st("gross_revenue", "revenue", k) -
      st("gross_revenue", "sales_return", k) -
      st("gross_revenue", "platform_fee", k),
  );
  const grossProfit = computeRow(
    (k) => totalRevenue[k] - st("cogs", "cogs", k) - st("cogs", "sales_tax", k),
  );
  const netProfit = computeRow(
    (k) =>
      grossProfit[k] -
      st("marketing", "ad_spends", k) -
      st("opex", "labour", k) -
      st("opex", "other_opex", k),
  );
  const balance = computeRow(
    (k) => netProfit[k] - st("distribution", "distribution", k),
  );

  // Per-column denominator for % display. "Gross Revenue" = the Revenue
  // section (accounts 4040-4080) — i.e. top-line sales before returns/fees.
  const denomByCol: Record<string, number> = {};
  for (const c of valueColumns) {
    denomByCol[c.key] = st("gross_revenue", "revenue", c.key);
  }

  // Emit a flat list of rows in render order.
  const rows: PnlRow[] = [];
  for (const grp of STRUCTURE) {
    rows.push({ kind: "group", label: grp.label });
    for (const sec of grp.sections) {
      const sectionId = `${grp.key}/${sec.key}`;
      const secIds = sectionAccountIds.get(sectionId) ?? [];
      rows.push({
        kind: "section",
        sectionId,
        label: sec.label,
        total: sectionTotals.get(sectionId) ?? emptyRecord(),
        accountIds: secIds,
      });
      for (const r of sectionAccountRows.get(sectionId) ?? []) {
        rows.push({
          kind: "account",
          sectionId,
          accountId: r.accountId,
          accountCode: r.accountCode,
          manualEditable: r.manualEditable,
          label: r.label,
          values: r.values,
        });
      }
    }
    if (grp.key === "gross_revenue") {
      rows.push({
        kind: "computed",
        label: "Total Revenue",
        values: totalRevenue,
        emphasis: "primary",
        accountIds: ids(
          "gross_revenue/revenue",
          "gross_revenue/sales_return",
          "gross_revenue/platform_fee",
        ),
      });
    } else if (grp.key === "cogs") {
      rows.push({
        kind: "computed",
        label: "Gross Profit",
        values: grossProfit,
        emphasis: "primary",
        accountIds: ids(
          "gross_revenue/revenue",
          "gross_revenue/sales_return",
          "gross_revenue/platform_fee",
          "cogs/cogs",
          "cogs/sales_tax",
        ),
      });
    } else if (grp.key === "opex") {
      rows.push({
        kind: "computed",
        label: "Net Profit",
        values: netProfit,
        emphasis: "highlight",
        accountIds: ids(
          "gross_revenue/revenue",
          "gross_revenue/sales_return",
          "gross_revenue/platform_fee",
          "cogs/cogs",
          "cogs/sales_tax",
          "marketing/ad_spends",
          "opex/labour",
          "opex/other_opex",
        ),
      });
    } else if (grp.key === "distribution") {
      rows.push({
        kind: "computed",
        label: "Balance",
        values: balance,
        emphasis: "highlight",
        accountIds: ids(
          "gross_revenue/revenue",
          "gross_revenue/sales_return",
          "gross_revenue/platform_fee",
          "cogs/cogs",
          "cogs/sales_tax",
          "marketing/ad_spends",
          "opex/labour",
          "opex/other_opex",
          "distribution/distribution",
        ),
      });
    }
  }

  const document: PnlDocument = {
    view,
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
    accounts: accounts.map((a) => ({
      id: a.id,
      code: a.account_code,
      name: a.account_name,
    })),
  };

  const subtitleSuffix =
    view === "monthly"
      ? `FY ${year} · ${monthlyEntityCol.label}`
      : view === "current-month"
        ? `${range.label} · All entity columns`
        : `${period.label} · All entity columns`;

  return (
    <PageShell page="pnl" title="Profit & Loss" subtitle={subtitleSuffix}>
      <PnlClient doc={document} />
    </PageShell>
  );
}
