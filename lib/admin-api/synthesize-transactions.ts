import "server-only";
import {
  PaymentMethodReport,
  SalesSummarySnapshot,
} from "./schemas";
import { apiCompanyToEntityCode } from "./entity-mapping";
import type { Insert } from "@/lib/supabase/types";

export type SynthesizedRaw = {
  raw: Omit<Insert<"raw_transactions">, "id">;
  /** Target account code for auto-classification after insertion. */
  accountCode: string;
  /** Entity code for the resulting transactions row (raw row stores the id). */
  entityCode: string;
};

export type SynthesizeResult = {
  rows: SynthesizedRaw[];
  unparsed: boolean;
};

/**
 * Mapping mirrors lib/admin-api/journal-mapping.ts (must stay in sync):
 *   - 4040/4050/4060 ← cc+gpay+klarna / paypal / check_wire
 *   - 4045/4055/4065 ← per-channel refunds (stored negative)
 *   - 5000          ← cogs (stored negative)
 *   - 6000/6001/6002/6003 ← google / meta / bing / asi (stored negative)
 *
 * Sign convention matches existing `transactions.amount` semantics so
 * signFor() in app/(app)/pnl/page.tsx works unchanged:
 *   revenue → +amount
 *   sales return → -amount   (signFor sales_return = -1, displays +)
 *   expense (cogs, ads) → -amount   (signFor expense = -1, displays +)
 */
const REVENUE = { STRIPE: "4040", PAYPAL: "4050", DIRECT: "4060" } as const;
const RETURN = { STRIPE: "4045", PAYPAL: "4055", DIRECT: "4065" } as const;
const COGS = "5000";
const ADS = { GOOGLE: "6000", META: "6001", BING: "6002", ASI: "6003" } as const;

export const SYNTHESIZED_ACCOUNT_CODES: readonly string[] = [
  REVENUE.STRIPE,
  REVENUE.PAYPAL,
  REVENUE.DIRECT,
  RETURN.STRIPE,
  RETURN.PAYPAL,
  RETURN.DIRECT,
  COGS,
  ADS.GOOGLE,
  ADS.META,
  ADS.BING,
  ADS.ASI,
];

export const ADMIN_API_RAW_SOURCE = "admin_api";

export type SnapshotInput = {
  id: string;
  source: "payment_method" | "sales_summary";
  payload: unknown;
};

/**
 * Convert a single cashbook_snapshots row into a batch of
 * `raw_transactions` inserts (one per non-zero day × entity ×
 * account-code). Each row carries its target account code so the
 * caller can auto-classify it through the standard classify path
 * after insertion. Returns `unparsed: true` if the payload doesn't
 * match the expected schema — caller should treat as soft-failure.
 */
export function synthesizeTransactionRows(
  snapshot: SnapshotInput,
  codeToAccountId: Map<string, string>,
  entityCodeToId: Record<string, string>,
): SynthesizeResult {
  const rows: SynthesizedRaw[] = [];

  function emit(o: {
    date: string;
    entity: string;
    accountCode: string;
    amount: number;
    description: string;
    memo: string | null;
    vendor: string | null;
  }) {
    if (o.amount === 0) return;
    if (!codeToAccountId.has(o.accountCode)) return;
    const entityId = entityCodeToId[o.entity] ?? null;
    // raw_transactions stores amount as a positive value with `direction`
    // encoding the sign; matches how bank/CC imports store it (see
    // actions/import.ts).
    const rawAmount = Math.abs(o.amount);
    const direction: "DEBIT" | "CREDIT" = o.amount >= 0 ? "CREDIT" : "DEBIT";
    rows.push({
      accountCode: o.accountCode,
      entityCode: o.entity,
      raw: {
        entity_id: entityId,
        source: ADMIN_API_RAW_SOURCE,
        bank_connection_id: null,
        transaction_date: o.date,
        accounting_date: o.date,
        amount: rawAmount,
        direction,
        description: o.description,
        classified: false,
      },
    });
  }

  if (snapshot.source === "payment_method") {
    const parsed = PaymentMethodReport.safeParse(snapshot.payload);
    if (!parsed.success) return { rows: [], unparsed: true };
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
          accountCode: REVENUE.STRIPE,
          amount: stripe,
          description: "Stripe revenue (CC+GPay+Klarna)",
          memo: c.company_name,
          vendor: c.company_name,
        });
        emit({
          date: day.date,
          entity,
          accountCode: REVENUE.PAYPAL,
          amount: c.paypal ?? 0,
          description: "PayPal revenue",
          memo: c.company_name,
          vendor: c.company_name,
        });
        emit({
          date: day.date,
          entity,
          accountCode: REVENUE.DIRECT,
          amount: c.check_wire ?? 0,
          description: "Direct revenue (check/wire)",
          memo: c.company_name,
          vendor: c.company_name,
        });
        emit({
          date: day.date,
          entity,
          accountCode: RETURN.STRIPE,
          amount: -stripeRef,
          description: "Stripe refunds",
          memo: c.company_name,
          vendor: c.company_name,
        });
        emit({
          date: day.date,
          entity,
          accountCode: RETURN.PAYPAL,
          amount: -(c.refunds_paypal ?? 0),
          description: "PayPal refunds",
          memo: c.company_name,
          vendor: c.company_name,
        });
        emit({
          date: day.date,
          entity,
          accountCode: RETURN.DIRECT,
          amount: -(c.refunds_check_wire ?? 0),
          description: "Direct refunds (check/wire)",
          memo: c.company_name,
          vendor: c.company_name,
        });
      }
    }
    return { rows, unparsed: false };
  }

  // sales_summary: now fetched with groupBy=day, so each row.period is a
  // YYYY-MM-DD date string. byCompany[id].rows gives per-day per-entity
  // breakdown for COGS + ad-spend.
  const wrapper = SalesSummarySnapshot.safeParse(snapshot.payload);
  if (!wrapper.success) return { rows: [], unparsed: true };
  for (const [companyIdStr, report] of Object.entries(
    wrapper.data.byCompany,
  )) {
    const entity = apiCompanyToEntityCode(Number(companyIdStr));
    if (!entity) continue;
    for (const row of report.rows) {
      const date = row.period;
      emit({
        date,
        entity,
        accountCode: COGS,
        amount: -(row.cogs ?? 0),
        description: "COGS (WB + SP)",
        memo: null,
        vendor: null,
      });
      emit({
        date,
        entity,
        accountCode: ADS.GOOGLE,
        amount: -(row.ads_cost_google ?? 0),
        description: "Google Ads",
        memo: null,
        vendor: "Google",
      });
      emit({
        date,
        entity,
        accountCode: ADS.META,
        amount: -(row.ads_cost_meta ?? 0),
        description: "Meta Ads",
        memo: null,
        vendor: "Meta",
      });
      emit({
        date,
        entity,
        accountCode: ADS.BING,
        amount: -(row.ads_cost_bing ?? 0),
        description: "Bing Ads",
        memo: null,
        vendor: "Bing",
      });
      emit({
        date,
        entity,
        accountCode: ADS.ASI,
        amount: -(row.ads_cost_asi ?? 0),
        description: "ASI Ads",
        memo: null,
        vendor: "ASI",
      });
    }
  }
  return { rows, unparsed: false };
}
