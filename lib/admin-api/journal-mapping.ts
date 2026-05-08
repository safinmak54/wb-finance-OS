import "server-only";
import type { PaymentMethodReport, SalesSummaryReport } from "./schemas";
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

const ACCT = {
  STRIPE_CLEARING: "1140",
  PAYPAL_CLEARING: "1150",
  AR: "1100",
  AP: "2010",
  STRIPE_REVENUE: "4010",
  PAYPAL_REVENUE: "4020",
  WIRE_REVENUE: "4030",
  RETURNS: "4900",
  COGS: "5010",
  GOOGLE_ADS: "6010",
  META_ADS: "6020",
  BING_ADS: "6040",
  ASI_ADS: "6050",
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

    const lines: JournalLineSpec[] = [];

    if (stripe > 0) {
      lines.push({ account_code: ACCT.STRIPE_CLEARING, debit: stripe, credit: 0, memo: "Stripe gross — to clearing" });
      lines.push({ account_code: ACCT.STRIPE_REVENUE, debit: 0, credit: stripe, memo: "Stripe revenue (CC + GPay + Klarna)" });
    }
    if (paypal > 0) {
      lines.push({ account_code: ACCT.PAYPAL_CLEARING, debit: paypal, credit: 0, memo: "PayPal gross — to clearing" });
      lines.push({ account_code: ACCT.PAYPAL_REVENUE, debit: 0, credit: paypal, memo: "PayPal revenue" });
    }
    if (wire > 0) {
      lines.push({ account_code: ACCT.AR, debit: wire, credit: 0, memo: "Wire/Check — A/R" });
      lines.push({ account_code: ACCT.WIRE_REVENUE, debit: 0, credit: wire, memo: "Wire/Check revenue" });
    }
    if (stripeRefunds > 0) {
      lines.push({ account_code: ACCT.RETURNS, debit: stripeRefunds, credit: 0, memo: "Stripe refunds (returns)" });
      lines.push({ account_code: ACCT.STRIPE_CLEARING, debit: 0, credit: stripeRefunds, memo: "Stripe refunds — from clearing" });
    }
    if (paypalRefunds > 0) {
      lines.push({ account_code: ACCT.RETURNS, debit: paypalRefunds, credit: 0, memo: "PayPal refunds (returns)" });
      lines.push({ account_code: ACCT.PAYPAL_CLEARING, debit: 0, credit: paypalRefunds, memo: "PayPal refunds — from clearing" });
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
  const asi = r(t.ads_cost_asi ?? 0);

  const expenses: JournalLineSpec[] = [];
  if (cogs > 0) expenses.push({ account_code: ACCT.COGS, debit: cogs, credit: 0, memo: "COGS (WB + SP)" });
  if (google > 0) expenses.push({ account_code: ACCT.GOOGLE_ADS, debit: google, credit: 0, memo: "Google Ads" });
  if (meta > 0) expenses.push({ account_code: ACCT.META_ADS, debit: meta, credit: 0, memo: "Meta Ads" });
  if (bing > 0) expenses.push({ account_code: ACCT.BING_ADS, debit: bing, credit: 0, memo: "Bing Ads" });
  if (asi > 0) expenses.push({ account_code: ACCT.ASI_ADS, debit: asi, credit: 0, memo: "ASI Ads" });

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
