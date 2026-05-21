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
  "SP",
  "RUSH",
  "ONEOPS",
] as const;
export type EntityCode = (typeof ALL_ENTITY_CODES)[number];

export const ENTITY_GROUPS = {
  "WB-ALL": [
    "WB",
    "WBP",
    "LP",
    "KP",
    "BP",
    "SP",
    "RUSH",
    "ONEOPS",
  ],
  wb_full: ["WBP", "LP", "KP", "BP", "RUSH"],
  one_ops: ["ONEOPS"],
  sp_brands: ["SP"],
} as const satisfies Record<string, readonly EntityCode[]>;

export type EntityGroupKey = keyof typeof ENTITY_GROUPS;

export type EntityFilterValue = "all" | EntityGroupKey | EntityCode;

export const ENTITY_LABELS: Record<EntityCode, string> = {
  WB: "WB Brands",
  WBP: "WB Promo",
  LP: "Lanyard Promo",
  KP: "Koolers Promo",
  BP: "Band Promo",
  SP: "SP Brands",
  RUSH: "Rushmore Ventures",
  ONEOPS: "One Operations",
};

export const PNL_ENTITY_COLUMNS: ReadonlyArray<{
  key: string;
  label: string;
  entityCodes: readonly EntityCode[];
}> = [
  { key: "ALL", label: "ALL", entityCodes: ALL_ENTITY_CODES },
  { key: "WB", label: "WB", entityCodes: ["WB"] },
  { key: "WBP", label: "WBP", entityCodes: ["WBP"] },
  { key: "LP", label: "LP", entityCodes: ["LP"] },
  { key: "BP", label: "BP", entityCodes: ["BP"] },
  { key: "SP", label: "SP", entityCodes: ["SP"] },
  { key: "ONEOPS", label: "One Ops", entityCodes: ["ONEOPS"] },
];

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
 * Bank-statement description → entity code matcher. Used by the CSV/XLSX
 * import flow to assign an entity per row from the bank statement
 * description column.
 *
 * Order matters: more specific patterns must come before more generic
 * ones (e.g. "wb promo" before "wb brands", "sp brands" before " sp ").
 */
const BANK_ACCOUNT_ENTITY_MAP: Array<{
  keywords: readonly string[];
  code: EntityCode;
}> = [
  { keywords: ["rushmore", "rush"], code: "RUSH" },
  { keywords: ["band promo"], code: "BP" },
  { keywords: ["koolers", "kooler", "coolers"], code: "KP" },
  { keywords: ["lanyard"], code: "LP" },
  { keywords: ["wb promo", "wbp"], code: "WBP" },
  { keywords: ["one operations", "one op", "oneop"], code: "ONEOPS" },
  { keywords: ["sp brands", "swagprint", "swag", " sp "], code: "SP" },
  { keywords: ["wb brands"], code: "WB" },
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
