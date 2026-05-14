import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  fetchReportData,
  groupByAccountAndEntity,
  type AccountAggregate,
} from "@/lib/queries/reports";
import { listAccounts } from "@/lib/queries/accounts";
import {
  periodFromSearchParams,
  yearRange,
  monthlyBuckets,
} from "@/lib/period";
import { ALL_ENTITY_CODES } from "@/lib/entities";
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
  const view = sp.view === "monthly" ? "monthly" : "annual";

  // This page always shows consolidated "all entities" — the
  // EntitySwitcher is ignored here per finance team's request.
  const year = Number(period.from.slice(0, 4));
  const range = view === "monthly" ? yearRange(year) : period;
  const months = view === "monthly" ? monthlyBuckets(year) : [];

  const supabase = createDataClient();
  const [data, accounts] = await Promise.all([
    fetchReportData(supabase, {
      entity: "all",
      from: range.from,
      to: range.to,
    }),
    listAccounts(supabase, { activeOnly: true }),
  ]);

  const aggregates = groupByAccountAndEntity(data.txns);

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

  // Value columns: annual = 1, monthly = 12 + Total
  type Column = { key: string; label: string; monthKey?: string };
  let valueColumns: Column[];
  if (view === "monthly") {
    valueColumns = months.map((m) => ({
      key: m.key,
      label: m.label,
      monthKey: m.key,
    }));
    valueColumns.push({ key: "TOTAL", label: "Total" });
  } else {
    valueColumns = [{ key: "ALL", label: "Value" }];
  }

  function valueFor(
    agg: AccountAggregate | undefined,
    account: Account,
    col: Column,
  ): number {
    if (!agg) return 0;
    let raw = 0;
    if (col.monthKey) {
      for (const code of ALL_ENTITY_CODES) {
        const m = agg.byEntityMonth.get(code);
        if (m) raw += m.get(col.monthKey) ?? 0;
      }
    } else {
      for (const code of ALL_ENTITY_CODES) {
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

  // Compute section totals up-front so we can also derive group-level
  // computed lines (Total Revenue, Gross Profit, Net Profit, Balance).
  const sectionTotals = new Map<string, Record<string, number>>();
  const sectionAccountRows = new Map<
    string,
    Array<{ accountId: string; label: string; values: Record<string, number> }>
  >();

  for (const grp of STRUCTURE) {
    for (const sec of grp.sections) {
      const accountsForSection = accountsBySubtype.get(sec.subtype) ?? [];
      const rows = accountsForSection.map((a) => ({
        accountId: a.id,
        label: `${a.account_code} · ${a.account_name}`,
        values: valuesForAccount(a),
      }));
      const total = emptyRecord();
      for (const c of valueColumns) {
        total[c.key] = rows.reduce((s, r) => s + r.values[c.key], 0);
      }
      sectionTotals.set(`${grp.key}/${sec.key}`, total);
      sectionAccountRows.set(`${grp.key}/${sec.key}`, rows);
    }
  }

  function st(grpKey: string, secKey: string, colKey: string): number {
    return sectionTotals.get(`${grpKey}/${secKey}`)?.[colKey] ?? 0;
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

  // Emit a flat list of rows in render order.
  const rows: PnlRow[] = [];
  for (const grp of STRUCTURE) {
    rows.push({ kind: "group", label: grp.label });
    for (const sec of grp.sections) {
      const sectionId = `${grp.key}/${sec.key}`;
      rows.push({
        kind: "section",
        sectionId,
        label: sec.label,
        total: sectionTotals.get(sectionId) ?? emptyRecord(),
      });
      for (const r of sectionAccountRows.get(sectionId) ?? []) {
        rows.push({
          kind: "account",
          sectionId,
          accountId: r.accountId,
          label: r.label,
          values: r.values,
        });
      }
    }
    // Computed lines after their parent group
    if (grp.key === "gross_revenue") {
      rows.push({
        kind: "computed",
        label: "Total Revenue",
        values: totalRevenue,
        emphasis: "primary",
      });
    } else if (grp.key === "cogs") {
      rows.push({
        kind: "computed",
        label: "Gross Profit",
        values: grossProfit,
        emphasis: "primary",
      });
    } else if (grp.key === "opex") {
      rows.push({
        kind: "computed",
        label: "Net Profit",
        values: netProfit,
        emphasis: "highlight",
      });
    } else if (grp.key === "distribution") {
      rows.push({
        kind: "computed",
        label: "Balance",
        values: balance,
        emphasis: "highlight",
      });
    }
  }

  const document: PnlDocument = {
    view,
    valueColumns: valueColumns.map((c) => ({ key: c.key, label: c.label })),
    rows,
    range,
    accounts: accounts.map((a) => ({
      id: a.id,
      code: a.account_code,
      name: a.account_name,
    })),
  };

  return (
    <PageShell
      page="pnl"
      title="Profit & Loss"
      subtitle={`${view === "monthly" ? `FY ${year}` : period.label} · All entities`}
    >
      <PnlClient doc={document} />
    </PageShell>
  );
}
