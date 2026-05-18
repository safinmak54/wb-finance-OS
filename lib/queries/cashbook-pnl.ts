import type { Sb } from "./_client";
import type { Account } from "@/lib/supabase/types";
import type { AccountAggregate } from "./reports";
import type { DrillDownTxn } from "./transactions";
import {
  PaymentMethodReport,
  SalesSummarySnapshot,
} from "@/lib/admin-api/schemas";
import { apiCompanyToEntityCode } from "@/lib/admin-api/entity-mapping";

/**
 * "For now" path: synthesise the P&L aggregate map directly from
 * cashbook_snapshots, bypassing the transactions table. This lets the
 * P&L show numbers as soon as Cashbook is refreshed — without needing
 * the Generate Journals → Post → transactions roundtrip.
 *
 * Mapping mirrors lib/admin-api/journal-mapping.ts (must stay in sync):
 *   - 4040/4050/4060 ← cc+gpay+klarna / paypal / check_wire
 *   - 4045/4055/4065 ← per-channel refunds
 *   - 5000          ← cogs
 *   - 6000/6001/6002/6003 ← google / meta / bing / asi
 *
 * Sign convention: stored as if they were `transactions.amount` rows so
 * the existing signFor() in app/(app)/pnl/page.tsx works unchanged:
 *   revenue → +amount   (signFor revenue = +1)
 *   sales return → -amount   (signFor sales_return = -1, displays +)
 *   expense (cogs, ads) → -amount   (signFor expense = -1, displays +)
 */
const REVENUE = { STRIPE: "4040", PAYPAL: "4050", DIRECT: "4060" } as const;
const RETURN = { STRIPE: "4045", PAYPAL: "4055", DIRECT: "4065" } as const;
const COGS = "5000";
const ADS = { GOOGLE: "6000", META: "6001", BING: "6002", ASI: "6003" } as const;

export type CashbookPnlResult = {
  aggregates: Map<string, AccountAggregate>;
  /** how many cashbook snapshot rows were folded in */
  snapshotCount: number;
  /** snapshots whose schema didn't parse (treated as ignored, not fatal) */
  unparsedCount: number;
};

export async function buildPnlAggregatesFromCashbook(
  supabase: Sb,
  args: {
    range: { from: string; to: string };
    accounts: readonly Account[];
  },
): Promise<CashbookPnlResult> {
  const codeToAccount = new Map<string, Account>();
  for (const a of args.accounts) codeToAccount.set(a.account_code, a);

  // Pull every snapshot whose period is fully inside the requested range.
  // Order by fetched_at desc and dedupe per (period_start, period_end, source)
  // so a later re-fetch supersedes an earlier one.
  const { data, error } = await supabase
    .from("cashbook_snapshots")
    .select("period_start, period_end, source, payload, fetched_at")
    .gte("period_start", args.range.from)
    .lte("period_end", args.range.to)
    .order("fetched_at", { ascending: false });
  if (error) {
    const code = (error as { code?: string }).code;
    // Table missing on this DB → behave like "no data yet" rather than crash.
    if (code === "42P01" || code === "PGRST205") {
      return { aggregates: new Map(), snapshotCount: 0, unparsedCount: 0 };
    }
    throw error;
  }

  const seen = new Set<string>();
  const snapshots: Array<{
    period_start: string;
    period_end: string;
    source: string;
    payload: unknown;
  }> = [];
  for (const row of data ?? []) {
    const key = `${row.period_start}|${row.period_end}|${row.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(row);
  }

  const out = new Map<string, AccountAggregate>();
  let unparsedCount = 0;

  function getOrInit(account: Account): AccountAggregate {
    let agg = out.get(account.id);
    if (!agg) {
      agg = {
        account: {
          id: account.id,
          account_code: account.account_code,
          account_name: account.account_name,
          account_type: account.account_type,
          account_subtype: account.account_subtype ?? null,
        },
        byEntity: new Map(),
        byMonth: new Map(),
        byEntityMonth: new Map(),
      };
      out.set(account.id, agg);
    }
    return agg;
  }

  function add(
    accountCode: string,
    entityCode: string,
    monthKey: string,
    amount: number,
  ) {
    if (amount === 0) return;
    const acct = codeToAccount.get(accountCode);
    if (!acct) return; // account doesn't exist in CoA → silently skip
    const agg = getOrInit(acct);
    agg.byEntity.set(entityCode, (agg.byEntity.get(entityCode) ?? 0) + amount);
    agg.byMonth.set(monthKey, (agg.byMonth.get(monthKey) ?? 0) + amount);
    let entMap = agg.byEntityMonth.get(entityCode);
    if (!entMap) {
      entMap = new Map();
      agg.byEntityMonth.set(entityCode, entMap);
    }
    entMap.set(monthKey, (entMap.get(monthKey) ?? 0) + amount);
  }

  for (const snap of snapshots) {
    // For monthly bucketing we use the snapshot's period_start month. A
    // single-month snapshot maps cleanly; a multi-month snapshot lands
    // entirely in its start month (and still rolls up correctly in the
    // annual total).
    const monthKey = snap.period_start.slice(0, 7);

    if (snap.source === "payment_method") {
      const parsed = PaymentMethodReport.safeParse(snap.payload);
      if (!parsed.success) {
        unparsedCount += 1;
        continue;
      }
      for (const c of parsed.data.totals.companies) {
        const entity = apiCompanyToEntityCode(c.company_id);
        if (!entity) continue;
        const stripe = (c.cc ?? 0) + (c.gpay ?? 0) + (c.klarna ?? 0);
        const stripeRef =
          (c.refunds_cc ?? 0) +
          (c.refunds_gpay ?? 0) +
          (c.refunds_klarna ?? 0);
        add(REVENUE.STRIPE, entity, monthKey, stripe);
        add(REVENUE.PAYPAL, entity, monthKey, c.paypal ?? 0);
        add(REVENUE.DIRECT, entity, monthKey, c.check_wire ?? 0);
        // Returns: store negative so signFor(sales_return)=-1 flips to display +.
        add(RETURN.STRIPE, entity, monthKey, -stripeRef);
        add(RETURN.PAYPAL, entity, monthKey, -(c.refunds_paypal ?? 0));
        add(RETURN.DIRECT, entity, monthKey, -(c.refunds_check_wire ?? 0));
      }
    } else if (snap.source === "sales_summary") {
      const wrapper = SalesSummarySnapshot.safeParse(snap.payload);
      if (!wrapper.success) {
        // Legacy aggregate-only snapshot (no byCompany). Skip — without a
        // per-entity breakdown we can't fill in the entity columns. The
        // user should hit Refresh to upgrade the snapshot.
        unparsedCount += 1;
        continue;
      }
      for (const [companyIdStr, report] of Object.entries(
        wrapper.data.byCompany,
      )) {
        const entity = apiCompanyToEntityCode(Number(companyIdStr));
        if (!entity) continue;
        const t = report.totals;
        // Expenses: store negative so signFor(expense)=-1 flips to display +.
        add(COGS, entity, monthKey, -(t.cogs ?? 0));
        add(ADS.GOOGLE, entity, monthKey, -(t.ads_cost_google ?? 0));
        add(ADS.META, entity, monthKey, -(t.ads_cost_meta ?? 0));
        add(ADS.BING, entity, monthKey, -(t.ads_cost_bing ?? 0));
        add(ADS.ASI, entity, monthKey, -(t.ads_cost_asi ?? 0));
      }
    }
  }

  return {
    aggregates: out,
    snapshotCount: snapshots.length,
    unparsedCount,
  };
}

/**
 * Drill-down for cashbook-sourced P&L. Returns DrillDownTxn-shaped rows
 * synthesized from the snapshot payloads so the existing modal can render
 * them. These rows are READ-ONLY — they reflect API state, not a posted
 * transaction. Synthetic ids are prefixed `cb-` so the UI can distinguish.
 *
 * - Revenue / returns (4040/4050/4060, 4045/4055/4065): one row per day,
 *   per entity from payment-method `rows[].companies[]`.
 * - COGS / ads (5000, 6000-6003): one row per month bucket from
 *   sales-summary `byCompany[id].rows[]`. (Daily granularity would need
 *   groupBy=day on the API side.)
 */
export async function drillFromCashbook(
  supabase: Sb,
  args: {
    accountIds: readonly string[];
    entityCodes: readonly string[]; // empty → no entity filter
    range: { from: string; to: string };
    accounts: readonly Account[];
  },
): Promise<DrillDownTxn[]> {
  const codeToId = new Map<string, string>();
  const idToCode = new Map<string, string>();
  for (const a of args.accounts) {
    codeToId.set(a.account_code, a.id);
    idToCode.set(a.id, a.account_code);
  }

  const targetCodes = new Set<string>();
  for (const id of args.accountIds) {
    const code = idToCode.get(id);
    if (code) targetCodes.add(code);
  }
  if (targetCodes.size === 0) return [];

  const { data, error } = await supabase
    .from("cashbook_snapshots")
    .select("period_start, period_end, source, payload, fetched_at")
    .gte("period_start", args.range.from)
    .lte("period_end", args.range.to)
    .order("fetched_at", { ascending: false });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "PGRST205") return [];
    throw error;
  }

  const seen = new Set<string>();
  const snapshots: Array<{
    period_start: string;
    period_end: string;
    source: string;
    payload: unknown;
  }> = [];
  for (const row of data ?? []) {
    const key = `${row.period_start}|${row.period_end}|${row.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    snapshots.push(row);
  }

  const entityFilter =
    args.entityCodes.length > 0 ? new Set(args.entityCodes) : null;

  const out: DrillDownTxn[] = [];
  let counter = 0;
  function emit(o: {
    date: string;
    entity: string;
    accountCode: string;
    amount: number;
    description: string;
    memo: string;
  }) {
    if (!targetCodes.has(o.accountCode)) return;
    if (entityFilter && !entityFilter.has(o.entity)) return;
    if (o.amount === 0) return;
    const accountId = codeToId.get(o.accountCode);
    if (!accountId) return;
    out.push({
      id: `cb-${counter++}-${o.date}-${o.entity}-${o.accountCode}`,
      acc_date: o.date,
      description: `[ADMIN_API] ${o.description}`,
      entity: o.entity,
      amount: o.amount,
      account_id: accountId,
      memo: o.memo,
      raw_transaction_id: null,
    });
  }

  for (const snap of snapshots) {
    if (snap.source === "payment_method") {
      const parsed = PaymentMethodReport.safeParse(snap.payload);
      if (!parsed.success) continue;
      for (const day of parsed.data.rows) {
        for (const c of day.companies) {
          const entity = apiCompanyToEntityCode(c.company_id);
          if (!entity) continue;
          const stripe = (c.cc ?? 0) + (c.gpay ?? 0) + (c.klarna ?? 0);
          const stripeRef =
            (c.refunds_cc ?? 0) +
            (c.refunds_gpay ?? 0) +
            (c.refunds_klarna ?? 0);
          emit({
            date: day.date,
            entity,
            accountCode: "4040",
            amount: stripe,
            description: "Stripe revenue (CC+GPay+Klarna)",
            memo: c.company_name,
          });
          emit({
            date: day.date,
            entity,
            accountCode: "4050",
            amount: c.paypal ?? 0,
            description: "PayPal revenue",
            memo: c.company_name,
          });
          emit({
            date: day.date,
            entity,
            accountCode: "4060",
            amount: c.check_wire ?? 0,
            description: "Direct revenue (check/wire)",
            memo: c.company_name,
          });
          emit({
            date: day.date,
            entity,
            accountCode: "4045",
            amount: -stripeRef,
            description: "Stripe refunds",
            memo: c.company_name,
          });
          emit({
            date: day.date,
            entity,
            accountCode: "4055",
            amount: -(c.refunds_paypal ?? 0),
            description: "PayPal refunds",
            memo: c.company_name,
          });
          emit({
            date: day.date,
            entity,
            accountCode: "4065",
            amount: -(c.refunds_check_wire ?? 0),
            description: "Direct refunds (check/wire)",
            memo: c.company_name,
          });
        }
      }
    } else if (snap.source === "sales_summary") {
      const wrapper = SalesSummarySnapshot.safeParse(snap.payload);
      if (!wrapper.success) continue;
      for (const [companyIdStr, report] of Object.entries(
        wrapper.data.byCompany,
      )) {
        const entity = apiCompanyToEntityCode(Number(companyIdStr));
        if (!entity) continue;
        for (const row of report.rows) {
          // Snapshot is groupBy=month → use period_end as the row date.
          const date = snap.period_end;
          emit({
            date,
            entity,
            accountCode: "5000",
            amount: -(row.cogs ?? 0),
            description: "COGS (WB + SP)",
            memo: `${row.period} monthly aggregate`,
          });
          emit({
            date,
            entity,
            accountCode: "6000",
            amount: -(row.ads_cost_google ?? 0),
            description: "Google Ads",
            memo: `${row.period} monthly aggregate`,
          });
          emit({
            date,
            entity,
            accountCode: "6001",
            amount: -(row.ads_cost_meta ?? 0),
            description: "Meta Ads",
            memo: `${row.period} monthly aggregate`,
          });
          emit({
            date,
            entity,
            accountCode: "6002",
            amount: -(row.ads_cost_bing ?? 0),
            description: "Bing Ads",
            memo: `${row.period} monthly aggregate`,
          });
          emit({
            date,
            entity,
            accountCode: "6003",
            amount: -(row.ads_cost_asi ?? 0),
            description: "ASI Ads",
            memo: `${row.period} monthly aggregate`,
          });
        }
      }
    }
  }

  out.sort((a, b) => b.acc_date.localeCompare(a.acc_date));
  return out;
}
