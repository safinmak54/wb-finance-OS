import "server-only";
import { adminApiFetch } from "./client";
import {
  PaymentMethodReport,
  SalesSummaryReport,
} from "./schemas";

export type PaymentMethodMode = "company" | "company-by-date";

export async function fetchPaymentMethodReport(args: {
  startDate: string;
  endDate: string;
  mode?: PaymentMethodMode;
}) {
  return adminApiFetch(
    "/v1/reports/payment-method",
    {
      report_type: args.mode ?? "company",
      start_date: args.startDate,
      end_date: args.endDate,
    },
    PaymentMethodReport,
  );
}

export type SalesSummaryGroupBy = "day" | "week" | "month" | "year";

export async function fetchSalesSummaryLive(args: {
  startDate: string;
  endDate: string;
  groupBy?: SalesSummaryGroupBy;
  segment?: "all" | "asi" | "website";
  // Per the Admin API guide §3.2: comma-separated or repeated. Cannot be
  // combined with storeIds. When set, channel-split fields (net_sales_asi
  // etc.) come back null but COGS/ads/orders are populated.
  companyIds?: number[];
}) {
  return adminApiFetch(
    "/v1/reports/sales-summary/live",
    {
      startDate: args.startDate,
      endDate: args.endDate,
      groupBy: args.groupBy ?? "month",
      segment: args.segment ?? "all",
      companyIds:
        args.companyIds && args.companyIds.length > 0
          ? args.companyIds.join(",")
          : undefined,
    },
    SalesSummaryReport,
  );
}
