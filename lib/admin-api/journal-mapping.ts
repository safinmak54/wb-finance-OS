import "server-only";
import type {
  PaymentMethodReport,
  SalesSummaryReport,
  SalesSummarySnapshot,
} from "./schemas";
import { apiCompanyToEntityCode } from "./entity-mapping";

export type JournalLineSpec = {
  account_code: string;
  debit: number;
  credit: number;
  memo: string;
};

export type JournalSpec = {
  entity: string;
  accounting_date: string;
  description: string;
  entry_type: "accrual";
  status: "draft";
  source: "ADMIN_API";
  lines: JournalLineSpec[];
};

/**
 * P&L-side account codes are pinned against the chart of accounts shown
 * on the live Profit & Loss page. Balance-sheet codes (clearing / AR / AP)
 * are placeholders pending verification against the BS chart — flagged in
 * docs/cashbook-admin-api-payloads.json.
 */
const ACCT = {
  // Balance-sheet — VERIFY THESE CODES EXIST IN YOUR CoA before posting.
  STRIPE_CLEARING: "1140",
  PAYPAL_CLEARING: "1150",
  AR: "1100",
  AP: "2010",
  // P&L revenue (Gross Revenue group)
  STRIPE_REVENUE: "4040",
  PAYPAL_REVENUE: "4050",
  WIRE_REVENUE: "4060",
  // P&L sales returns (per channel)
  STRIPE_RETURN: "4045",
  PAYPAL_RETURN: "4055",
  DIRECT_RETURN: "4065",
  // P&L COGS (WB + SP combined — SP cost component is bundled by the API)
  COGS_WB_SP: "5000",
  // P&L marketing
  GOOGLE_ADS: "6000",
  META_ADS: "6001",
  BING_ADS: "6002",
  MNTN_ADS: "6005",
  ASI_ADS: "6003",
} as const;

/** Smallest cent rounding to dodge float drift. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * One JE per company per period. Recognises gross revenue on order date
 * (debits the processor's clearing/AR account, credits revenue) and the
 * day-of refunds (debits Returns contra-revenue, credits clearing).
 *
 * Companies whose API id has no entity mapping are skipped — the caller
 * surfaces a count so the user knows.
 */
export function buildPaymentMethodJournals(
  report: PaymentMethodReport,
  accountingDate: string,
): { journals: JournalSpec[]; skippedCompanyIds: number[] } {
  const period = accountingDate.slice(0, 7);
  const journals: JournalSpec[] = [];
  const skipped: number[] = [];

  for (const c of report.totals.companies) {
    const entity = apiCompanyToEntityCode(c.company_id);
    if (!entity) {
      if (hasAnyAmount(c)) skipped.push(c.company_id);
      continue;
    }

    const stripe = r((c.cc ?? 0) + (c.gpay ?? 0) + (c.klarna ?? 0));
    const stripeRefunds = r(
      (c.refunds_cc ?? 0) + (c.refunds_gpay ?? 0) + (c.refunds_klarna ?? 0),
    );
    const paypal = r(c.paypal ?? 0);
    const paypalRefunds = r(c.refunds_paypal ?? 0);
    const wire = r(c.check_wire ?? 0);
    const wireRefunds = r(c.refunds_check_wire ?? 0);

    // Not mapped (still need P&L target accounts):
    //   c.store_credits    — contra-revenue? confirm with CPA
    //   c.asi_pending      — A/R item, not P&L
    //   c.refunds (rollup) — already captured per-channel above

    const lines: JournalLineSpec[] = [];

    if (stripe > 0) {
      lines.push({ account_code: ACCT.STRIPE_CLEARING, debit: stripe, credit: 0, memo: "Stripe gross — to clearing" });
      lines.push({ account_code: ACCT.STRIPE_REVENUE, debit: 0, credit: stripe, memo: "Stripe revenue (CC + GPay + Klarna) → 4040" });
    }
    if (paypal > 0) {
      lines.push({ account_code: ACCT.PAYPAL_CLEARING, debit: paypal, credit: 0, memo: "PayPal gross — to clearing" });
      lines.push({ account_code: ACCT.PAYPAL_REVENUE, debit: 0, credit: paypal, memo: "PayPal revenue → 4050" });
    }
    if (wire > 0) {
      lines.push({ account_code: ACCT.AR, debit: wire, credit: 0, memo: "Wire/Check — A/R" });
      lines.push({ account_code: ACCT.WIRE_REVENUE, debit: 0, credit: wire, memo: "Direct revenue (check/wire) → 4060" });
    }
    if (stripeRefunds > 0) {
      lines.push({ account_code: ACCT.STRIPE_RETURN, debit: stripeRefunds, credit: 0, memo: "Stripe refunds → 4045" });
      lines.push({ account_code: ACCT.STRIPE_CLEARING, debit: 0, credit: stripeRefunds, memo: "Stripe refunds — from clearing" });
    }
    if (paypalRefunds > 0) {
      lines.push({ account_code: ACCT.PAYPAL_RETURN, debit: paypalRefunds, credit: 0, memo: "PayPal refunds → 4055" });
      lines.push({ account_code: ACCT.PAYPAL_CLEARING, debit: 0, credit: paypalRefunds, memo: "PayPal refunds — from clearing" });
    }
    if (wireRefunds > 0) {
      lines.push({ account_code: ACCT.DIRECT_RETURN, debit: wireRefunds, credit: 0, memo: "Direct refunds → 4065" });
      lines.push({ account_code: ACCT.AR, debit: 0, credit: wireRefunds, memo: "Wire/Check refunds — from A/R" });
    }

    if (lines.length === 0) continue;

    journals.push({
      entity,
      accounting_date: accountingDate,
      description: `Revenue & refunds — ${entity} — ${period}`,
      entry_type: "accrual",
      status: "draft",
      source: "ADMIN_API",
      lines,
    });
  }

  return { journals, skippedCompanyIds: skipped };
}

function hasAnyAmount(c: PaymentMethodReport["totals"]["companies"][number]): boolean {
  return (
    (c.cc ?? 0) > 0 ||
    (c.gpay ?? 0) > 0 ||
    (c.klarna ?? 0) > 0 ||
    (c.paypal ?? 0) > 0 ||
    (c.check_wire ?? 0) > 0 ||
    (c.refunds ?? 0) > 0
  );
}

/**
 * One JE for COGS + ad spend, posted against the parent entity (WB).
 * Sales-summary has no per-company dimension for these lines, so they
 * book at the consolidation level and get distributed via separate JEs
 * later if the user wants to allocate them out.
 */
export function buildSalesSummaryJournal(
  report: SalesSummaryReport,
  accountingDate: string,
  parentEntityCode = "WB",
): JournalSpec | null {
  const t = report.totals;
  const period = accountingDate.slice(0, 7);

  const cogs = r(t.cogs ?? 0);
  const google = r(t.ads_cost_google ?? 0);
  const meta = r(t.ads_cost_meta ?? 0);
  const bing = r(t.ads_cost_bing ?? 0);
  const mntn = r(t.ads_cost_mntn ?? 0);
  const asi = r(t.ads_cost_asi ?? 0);

  const expenses: JournalLineSpec[] = [];
  if (cogs > 0) expenses.push({ account_code: ACCT.COGS_WB_SP, debit: cogs, credit: 0, memo: "COGS (WB + SP) → 5000" });
  if (google > 0) expenses.push({ account_code: ACCT.GOOGLE_ADS, debit: google, credit: 0, memo: "Google Ads → 6000" });
  if (meta > 0) expenses.push({ account_code: ACCT.META_ADS, debit: meta, credit: 0, memo: "Meta Ads → 6001" });
  if (bing > 0) expenses.push({ account_code: ACCT.BING_ADS, debit: bing, credit: 0, memo: "Bing Ads → 6002" });
  if (mntn > 0) expenses.push({ account_code: ACCT.MNTN_ADS, debit: mntn, credit: 0, memo: "MNTN Ads → 6005" });
  if (asi > 0) expenses.push({ account_code: ACCT.ASI_ADS, debit: asi, credit: 0, memo: "ASI Ads → 6003" });

  if (expenses.length === 0) return null;

  const total = r(expenses.reduce((s, l) => s + l.debit, 0));
  const lines: JournalLineSpec[] = [
    ...expenses,
    { account_code: ACCT.AP, debit: 0, credit: total, memo: "A/P offset (settled when invoices clear)" },
  ];

  return {
    entity: parentEntityCode,
    accounting_date: accountingDate,
    description: `COGS & ad spend — ${period}`,
    entry_type: "accrual",
    status: "draft",
    source: "ADMIN_API",
    lines,
  };
}

/**
 * Per-entity COGS + ad spend JEs from the new snapshot wrapper.
 * Uses the `byCompany` map (one /sales-summary/live call per company_id)
 * to post each entity's COGS + ads against its own entity row, so the
 * P&L per-entity column lights up correctly.
 *
 * Companies whose API id has no entity mapping are skipped — caller
 * surfaces the count via skippedCompanyIds.
 */
export function buildSalesSummaryJournalsByCompany(
  snapshot: SalesSummarySnapshot,
  accountingDate: string,
): { journals: JournalSpec[]; skippedCompanyIds: number[] } {
  const period = accountingDate.slice(0, 7);
  const journals: JournalSpec[] = [];
  const skipped: number[] = [];

  for (const [companyIdStr, report] of Object.entries(snapshot.byCompany)) {
    const companyId = Number(companyIdStr);
    const entity = apiCompanyToEntityCode(companyId);
    const t = report.totals;

    const cogs = r(t.cogs ?? 0);
    const google = r(t.ads_cost_google ?? 0);
    const meta = r(t.ads_cost_meta ?? 0);
    const bing = r(t.ads_cost_bing ?? 0);
    const mntn = r(t.ads_cost_mntn ?? 0);
    const asi = r(t.ads_cost_asi ?? 0);
    const total = r(cogs + google + meta + bing + mntn + asi);

    if (total === 0) continue;
    if (!entity) {
      skipped.push(companyId);
      continue;
    }

    const expenses: JournalLineSpec[] = [];
    if (cogs > 0)
      expenses.push({ account_code: ACCT.COGS_WB_SP, debit: cogs, credit: 0, memo: "COGS (WB + SP) → 5000" });
    if (google > 0)
      expenses.push({ account_code: ACCT.GOOGLE_ADS, debit: google, credit: 0, memo: "Google Ads → 6000" });
    if (meta > 0)
      expenses.push({ account_code: ACCT.META_ADS, debit: meta, credit: 0, memo: "Meta Ads → 6001" });
    if (bing > 0)
      expenses.push({ account_code: ACCT.BING_ADS, debit: bing, credit: 0, memo: "Bing Ads → 6002" });
    if (mntn > 0)
      expenses.push({ account_code: ACCT.MNTN_ADS, debit: mntn, credit: 0, memo: "MNTN Ads → 6005" });
    if (asi > 0)
      expenses.push({ account_code: ACCT.ASI_ADS, debit: asi, credit: 0, memo: "ASI Ads → 6003" });

    const lines: JournalLineSpec[] = [
      ...expenses,
      { account_code: ACCT.AP, debit: 0, credit: total, memo: "A/P offset (settled when invoices clear)" },
    ];

    journals.push({
      entity,
      accounting_date: accountingDate,
      description: `COGS & ad spend — ${entity} — ${period}`,
      entry_type: "accrual",
      status: "draft",
      source: "ADMIN_API",
      lines,
    });
  }

  return { journals, skippedCompanyIds: skipped };
}
