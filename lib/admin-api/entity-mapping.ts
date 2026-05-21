import type { EntityCode } from "@/lib/entities";

/**
 * SwagPrint Admin API `company_id` → internal entity code.
 *
 * The five LLCs returned by /v1/reports/payment-method correspond
 * one-to-one with five of the WB Brands entities. Other entities
 * (WB Brands LLC parent, RUSH, ONEOPS) do not appear in the API.
 *
 * If the API ever introduces a new company we have no mapping for,
 * `apiCompanyToEntityCode` returns null — callers should fall back
 * to the API's `company_name` for display and skip auto-mapping
 * when posting journals.
 */
const COMPANY_ID_TO_ENTITY: Readonly<Record<number, EntityCode>> = {
  1: "KP",   // Koolers Promo LLC
  2: "LP",   // Lanyard Promo LLC
  3: "SP",   // SP Brands LLC (Swagprint)
  4: "BP",   // Band Promo LLC
  5: "WBP",  // WB Promo LLC
};

export function apiCompanyToEntityCode(
  companyId: number,
): EntityCode | null {
  return COMPANY_ID_TO_ENTITY[companyId] ?? null;
}
