import "server-only";
import { z } from "zod";

const num = z.number();
const numNullable = z.number().nullable();

const CompanyPaymentRow = z.object({
  company_id: z.number().int(),
  company_name: z.string(),
  cc: num,
  paypal: num,
  gpay: num,
  klarna: num,
  check_wire: num,
  gross_sales: num,
  refunds: num,
  refunds_cc: num,
  refunds_paypal: num,
  refunds_gpay: num,
  refunds_klarna: num,
  refunds_check_wire: num,
  asi_pending: num,
  store_credits: num,
  net_sales: num,
  website_po: numNullable,
  website_pay_later: numNullable,
  website_pending_total: numNullable,
});
export type CompanyPaymentRow = z.infer<typeof CompanyPaymentRow>;

const TotalPaymentRow = CompanyPaymentRow.omit({
  company_id: true,
  company_name: true,
});
export type TotalPaymentRow = z.infer<typeof TotalPaymentRow>;

export const PaymentMethodReport = z.object({
  report_type: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  all_companies: z.array(
    z.object({ id: z.number().int(), company_name: z.string() }),
  ),
  rows: z.array(
    z.object({
      date: z.string(),
      companies: z.array(CompanyPaymentRow),
      total: TotalPaymentRow,
    }),
  ),
  totals: z.object({
    companies: z.array(CompanyPaymentRow),
    total: TotalPaymentRow,
  }),
});
export type PaymentMethodReport = z.infer<typeof PaymentMethodReport>;

// Sales-summary rows have a wide field set that varies slightly between
// versions (the dev API adds per-segment breakdowns the doc doesn't list,
// drops a few that the doc does, and renames `aov`→`avg_order_value` and
// `profit_pct`→`gross_margin_pct`). We pin only the fields the Cashbook
// page consumes; .passthrough() preserves the rest in the JSONB snapshot
// so we can backfill UI without re-fetching.
export const SalesSummaryRow = z
  .object({
    period: z.string(),
    gross_sales: num,
    net_sales: num,
    orders_count: z.number().int(),
    cogs: num,
    cogs_invoiced: num.optional(),
    cogs_estimated: num.optional(),
    cogs_pct: num.optional(),
    ads_cost_total: num,
    // The dev API now reports per-platform ad spend under `platform_costs`
    // ({ go: google, fb: meta, bi: bing, mn: mntn/ctv }) and no longer sends
    // the flat ads_cost_google/meta/bing fields. `mn` (MNTN/CTV) is new in the
    // v2 doc. Accept both shapes: keep the flat fields optional and backfill
    // them from platform_costs in the transform below so downstream consumers
    // (synthesize / journal-mapping / KPI tiles) read a stable field set.
    ads_cost_google: num.optional(),
    ads_cost_bing: num.optional(),
    ads_cost_meta: num.optional(),
    ads_cost_mntn: num.optional(),
    platform_costs: z
      .object({ go: num, fb: num, bi: num, mn: num })
      .partial()
      .passthrough()
      .optional(),
    ads_cost_asi: num,
    ads_pct: num.optional(),
    roas: num.nullable().optional(),
    avg_order_value: num.nullable().optional(),
    total_refunds: num.optional(),
    cancellations: num.optional(),
    orders_cancelled: z.number().int().optional(),
    orders_refunded: z.number().int().optional(),
    orders_returned: z.number().int().optional(),
    gross_margin_pct: num.optional(),
    target_net_sales: num.nullable().optional(),
  })
  .passthrough()
  .transform((r) => ({
    ...r,
    ads_cost_google: r.ads_cost_google ?? r.platform_costs?.go ?? 0,
    ads_cost_meta: r.ads_cost_meta ?? r.platform_costs?.fb ?? 0,
    ads_cost_bing: r.ads_cost_bing ?? r.platform_costs?.bi ?? 0,
    ads_cost_mntn: r.ads_cost_mntn ?? r.platform_costs?.mn ?? 0,
  }));
export type SalesSummaryRow = z.infer<typeof SalesSummaryRow>;

export const SalesSummaryReport = z.object({
  rows: z.array(SalesSummaryRow),
  totals: SalesSummaryRow,
});
export type SalesSummaryReport = z.infer<typeof SalesSummaryReport>;

/**
 * What we actually store in `cashbook_snapshots.payload` for
 * `source = 'sales_summary'`. The aggregate is the no-filter call (all
 * companies, all channels) — channel-split fields are populated. Each
 * entry in `byCompany` is the same endpoint called with `companyIds=<id>`,
 * which the API guide says will null-out the channel-split fields but
 * keeps COGS / ads / orders per company.
 *
 * Backward compat: snapshots written before this shape change contain a
 * raw `SalesSummaryReport`. Read paths fall back to that shape if
 * `aggregate` is missing.
 */
export const SalesSummarySnapshot = z.object({
  aggregate: SalesSummaryReport,
  // key = company_id (stringified for JSON-object compatibility).
  byCompany: z.record(z.string(), SalesSummaryReport),
});
export type SalesSummarySnapshot = z.infer<typeof SalesSummarySnapshot>;
