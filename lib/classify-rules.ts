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
  txn: Pick<RawTransaction, "description">,
  rules: readonly ClassificationRule[],
): Classification | null {
  const haystack = txn.description ?? "";
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
  txns: readonly Pick<RawTransaction, "id" | "description">[],
  rules: readonly ClassificationRule[],
): Map<string, Classification> {
  const out = new Map<string, Classification>();
  for (const t of txns) {
    const hit = classifyOne(t, rules);
    if (hit) out.set(t.id, hit);
  }
  return out;
}

export type TxnKind = "transfer" | "cc_payment" | "other";

const CC_PAYMENT_PATTERNS = [
  /\bcapital one online\b/i,
  /\bamex (?:epayment|payment)\b/i,
  /\bchase (?:card )?payment\b/i,
  /\bcitibank online payment\b/i,
  /\bdiscover (?:card )?payment\b/i,
  /\bbank of america credit card payment\b/i,
  /\bcredit card payment\b/i,
  /\bcc payment\b/i,
  // Card-side payment receipt, e.g. Amex "ONLINE PAYMENT - THANK YOU".
  /\bonline payment\b[\s-]*thank you\b/i,
];

const TRANSFER_PATTERNS = [
  /\bbus onl tfr\b/i,
  /DBT=D\//i,
];

/** Classify a transaction by kind for inbox grouping based purely on
 *  description patterns. */
export function detectTxnKind(
  row: Pick<RawTransaction, "description"> & {
    entity_code?: string | null;
  },
): TxnKind {
  const haystack = row.description ?? "";
  for (const re of CC_PAYMENT_PATTERNS) {
    if (re.test(haystack)) return "cc_payment";
  }
  for (const re of TRANSFER_PATTERNS) {
    if (re.test(haystack)) return "transfer";
  }
  return "other";
}
