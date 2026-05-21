/**
 * Bank-statement transaction-type → direction mapping.
 *
 * Many bank statements report all amounts as positive numbers and rely
 * on a "Transaction Type" / description string to signal whether the
 * row is money in (CREDIT) or money out (DEBIT). Used by the import
 * flow to override amount-sign detection when one of these patterns
 * appears in the description.
 *
 * Order matters: longer / more specific patterns must precede shorter
 * ones (e.g. "ach offset debit" before "ach debit").
 */
const DIRECTION_PATTERNS: Array<{
  pattern: string;
  direction: "DEBIT" | "CREDIT";
}> = [
  { pattern: "ach offset debit", direction: "DEBIT" },
  { pattern: "ach credit", direction: "CREDIT" },
  { pattern: "ach debit", direction: "DEBIT" },
  { pattern: "adjustment debit", direction: "DEBIT" },
  { pattern: "check paid", direction: "DEBIT" },
  { pattern: "deposit correction db", direction: "DEBIT" },
  { pattern: "electronic transfer credit", direction: "CREDIT" },
  { pattern: "electronic transfer debit", direction: "DEBIT" },
  { pattern: "miscellaneous fees", direction: "DEBIT" },
  { pattern: "regular deposit", direction: "CREDIT" },
  // Despite the "DEBIT" in the name, the bookkeeper has confirmed this
  // is a credit (positive) — it reverses a prior debit back into cash.
  { pattern: "returned cash item debit", direction: "CREDIT" },
  { pattern: "wire transfer credit", direction: "CREDIT" },
  { pattern: "wire transfer debit", direction: "DEBIT" },
];

export function detectDirectionFromDescription(
  description: string | null | undefined,
): "DEBIT" | "CREDIT" | null {
  if (!description) return null;
  const lower = description.toLowerCase();
  for (const entry of DIRECTION_PATTERNS) {
    if (lower.includes(entry.pattern)) return entry.direction;
  }
  return null;
}
