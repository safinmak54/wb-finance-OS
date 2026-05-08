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
}) {
  return adminApiFetch(
    "/v1/reports/sales-summary/live",
    {
      startDate: args.startDate,
      endDate: args.endDate,
      groupBy: args.groupBy ?? "month",
      segment: args.segment ?? "all",
    },
    SalesSummaryReport,
  );
}
