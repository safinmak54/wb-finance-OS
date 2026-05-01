/**
 * Entity scoping helpers.
 *
 * Mirrors `applyEntityFilter()` from legacy/app.js (~lines 88–92) but
 * works at the Supabase query-builder level for both `transactions`
 * (text `entity` column) and `raw_transactions` / `journal_entries`
 * (uuid `entity_id` column).
 */

import { ENTITY_GROUPS, type EntityFilterValue } from "./entities";

/** Returns the list of entity codes a filter value resolves to, or null
 *  for "all" (no filter). */
export function resolveEntityCodes(
  value: EntityFilterValue,
): readonly string[] | null {
  if (value === "all") return null;
  if (value in ENTITY_GROUPS) {
    return ENTITY_GROUPS[value as keyof typeof ENTITY_GROUPS];
  }
  // Single entity code
  return [value];
}

/** Apply entity filter to a query whose entity column is a TEXT code
 *  (e.g. `transactions.entity`, `cash_balances.entity`). No-ops on
 *  "all". */
export function applyEntityCodeFilter<Q extends { in(col: string, values: readonly string[]): Q }>(
  query: Q,
  column: string,
  value: EntityFilterValue,
): Q {
  const codes = resolveEntityCodes(value);
  if (!codes) return query;
  return query.in(column, codes);
}

/** Apply entity filter against a UUID `entity_id` column. Requires a
 *  pre-fetched code → id map. */
export function applyEntityIdFilter<Q extends { in(col: string, values: readonly string[]): Q }>(
  query: Q,
  column: string,
  value: EntityFilterValue,
  codeToId: Record<string, string>,
): Q {
  const codes = resolveEntityCodes(value);
  if (!codes) return query;
  const ids = codes
    .map((c) => codeToId[c])
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return query;
  return query.in(column, ids);
}

export function entityFilterFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): EntityFilterValue {
  const v = sp.entity;
  if (typeof v !== "string" || !v) return "all";
  return v as EntityFilterValue;
}
