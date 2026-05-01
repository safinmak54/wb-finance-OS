/**
 * Entities and entity grouping.
 *
 * Mirrors the constants in legacy/app.js (`ALL_ENTITY_CODES`, `ENTITY_GROUPS`,
 * `BANK_ACCOUNT_ENTITY_MAP`). The values are not authoritative against the
 * database; they are UI/labeling helpers.
 */

export const ALL_ENTITY_CODES = [
  "WB",
  "WBP",
  "LP",
  "KP",
  "BP",
  "SWAG",
  "RUSH",
  "ONEOPS",
  "SP1",
] as const;
export type EntityCode = (typeof ALL_ENTITY_CODES)[number];

export const ENTITY_GROUPS = {
  "WB-ALL": [
    "WB",
    "WBP",
    "LP",
    "KP",
    "BP",
    "SWAG",
    "RUSH",
    "ONEOPS",
    "SP1",
  ],
  wb_full: ["WBP", "LP", "KP", "BP", "SWAG", "RUSH"],
  one_ops: ["ONEOPS"],
  sp_brands: ["SP1"],
} as const satisfies Record<string, readonly EntityCode[]>;

export type EntityGroupKey = keyof typeof ENTITY_GROUPS;

export type EntityFilterValue = "all" | EntityGroupKey | EntityCode;

export const ENTITY_LABELS: Record<EntityCode, string> = {
  WB: "WB Brands",
  WBP: "WB Promo",
  LP: "Lanyard Promo",
  KP: "Koolers Promo",
  BP: "Band Promo",
  SWAG: "SWAG",
  RUSH: "RUSH",
  ONEOPS: "One Operations",
  SP1: "SP1",
};

export const ENTITY_FILTER_OPTIONS: Array<{
  value: EntityFilterValue;
  label: string;
}> = [
  { value: "all", label: "All Entities" },
  { value: "WB-ALL", label: "WB - All (Consolidated)" },
  ...ALL_ENTITY_CODES.map((code) => ({
    value: code,
    label: ENTITY_LABELS[code],
  })),
];

/**
 * Bank-account-name → entity code matcher. Mirrors
 * `BANK_ACCOUNT_ENTITY_MAP` + `detectEntityFromBankAccount` from
 * legacy/app.js (~lines 65–86). Used by the CSV/XLSX import flow to
 * suggest an entity per row.
 */
const BANK_ACCOUNT_ENTITY_MAP: Array<{
  keywords: readonly string[];
  code: EntityCode;
}> = [
  { keywords: ["lanyard", "lp "], code: "LP" },
  { keywords: ["kooler"], code: "KP" },
  { keywords: ["band promo"], code: "BP" },
  { keywords: ["wb promo", "wbp", "1918"], code: "WBP" },
  { keywords: ["wb brands", "2645"], code: "WB" },
  { keywords: ["rush"], code: "RUSH" },
  { keywords: ["swag"], code: "SWAG" },
  { keywords: ["sp brand", " sp "], code: "SP1" },
  { keywords: ["one op", "oneop", "one operations"], code: "ONEOPS" },
];

export function detectEntityFromBankAccount(
  name: string | null | undefined,
): EntityCode | null {
  if (!name) return null;
  const lower = ` ${name} `.toLowerCase();
  for (const entry of BANK_ACCOUNT_ENTITY_MAP) {
    if (entry.keywords.some((k) => lower.includes(k))) return entry.code;
  }
  return null;
}
