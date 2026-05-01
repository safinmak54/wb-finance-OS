/**
 * Auto-classification rules engine.
 *
 * Mirrors `bulkClassifyAutoTagged()` from legacy/app.js (~line 4519).
 * A `classification_rules` row maps a regex (or substring) pattern
 * against a transaction's `description` or `vendor` to a canonical
 * `account_id` (and optionally `vendor_id`).
 */

import type { ClassificationRule, RawTransaction } from "./supabase/types";

export type Classification = {
  ruleId: string;
  accountId: string | null;
  vendorId: string | null;
};

function compilePattern(pattern: string): RegExp | null {
  try {
    // Treat as case-insensitive substring unless it parses as a regex
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      const lastSlash = pattern.lastIndexOf("/");
      const body = pattern.slice(1, lastSlash);
      const flags = pattern.slice(lastSlash + 1) || "i";
      return new RegExp(body, flags);
    }
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, "i");
  } catch {
    return null;
  }
}

export function classifyOne(
  txn: Pick<RawTransaction, "description" | "vendor">,
  rules: readonly ClassificationRule[],
): Classification | null {
  const haystack = [txn.description ?? "", txn.vendor ?? ""].join(" | ");
  for (const rule of rules) {
    if (!rule.is_active) continue;
    const re = compilePattern(rule.pattern);
    if (!re) continue;
    if (re.test(haystack)) {
      return {
        ruleId: rule.id,
        accountId: rule.account_id ?? null,
        vendorId: rule.vendor_id ?? null,
      };
    }
  }
  return null;
}

export function classifyMany(
  txns: readonly Pick<RawTransaction, "id" | "description" | "vendor">[],
  rules: readonly ClassificationRule[],
): Map<string, Classification> {
  const out = new Map<string, Classification>();
  for (const t of txns) {
    const hit = classifyOne(t, rules);
    if (hit) out.set(t.id, hit);
  }
  return out;
}
