/** View vocabulary for the bank & CC transaction pages. Deliberately *not* a
 *  client module: the page resolves the URL on the server, and the cards +
 *  chip rows render it on the client — both import from here.
 *
 *  Three independent axes, one URL param each:
 *    ?tab=    which funnel card (the primary slice)
 *    ?status= To Classify / Finalized      — chip row 1, clearable
 *    ?kind=   All Set Aside / Internal Transfers / CC Payment — chip row 2,
 *             clearable
 *  The chip rows narrow whatever the card selected; clearing a chip removes
 *  that narrowing entirely. */

/** Which funnel card is active. The five values are a funnel:
 *  All → Set aside → To classify → (Auto-tagged | Manual). */
export type TxnTab = "all" | "set_aside" | "to_classify" | "auto" | "manual";

/** Chip row 1 — classification status. `null` means "don't narrow". */
export type TxnStatus = "to_classify" | "finalized";

/** Chip row 2 — set-aside kind. `null` means "don't narrow". */
export type TxnKindFilter = "set_aside" | "transfer" | "cc_payment";

export type TxnView = {
  tab: TxnTab;
  status: TxnStatus | null;
  kind: TxnKindFilter | null;
};

export const TXN_TABS: readonly TxnTab[] = [
  "all",
  "set_aside",
  "to_classify",
  "auto",
  "manual",
];

export const STATUS_OPTIONS: ReadonlyArray<{
  key: TxnStatus;
  label: string;
}> = [
  { key: "to_classify", label: "To Classify" },
  { key: "finalized", label: "Finalized" },
];

export const KIND_OPTIONS: ReadonlyArray<{
  key: TxnKindFilter;
  label: string;
}> = [
  { key: "set_aside", label: "All Set Aside" },
  { key: "transfer", label: "Internal Transfers" },
  { key: "cc_payment", label: "CC Payment" },
];

/** Credit-card rows are only ever charges or payments, so the internal-transfer
 *  chip is dropped on that page. */
export function kindOptionsFor(side: "bank" | "cc") {
  return side === "bank"
    ? KIND_OPTIONS
    : KIND_OPTIONS.filter((o) => o.key !== "transfer");
}

/** `?tab=` values from the tab bar that preceded the cards, mapped onto the
 *  card + chips that now show the same rows, so old links keep working. */
const LEGACY_VIEWS: Record<string, TxnView> = {
  transfer: { tab: "set_aside", status: null, kind: "transfer" },
  cc_payment: { tab: "set_aside", status: null, kind: "cc_payment" },
  remaining: { tab: "to_classify", status: null, kind: null },
  finalized: { tab: "all", status: "finalized", kind: null },
};

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** Resolve the URL into a legal (card, status, kind) triple. Unknown values
 *  fall back to "no narrowing" rather than erroring. */
export function resolveTxnView(
  sp: Record<string, string | string[] | undefined>,
  side: "bank" | "cc",
): TxnView {
  const rawTab = sp.tab;
  const legacy = typeof rawTab === "string" ? LEGACY_VIEWS[rawTab] : undefined;
  if (legacy) return legacy;

  return {
    tab: pick(rawTab, TXN_TABS) ?? "all",
    status: pick(
      sp.status,
      STATUS_OPTIONS.map((o) => o.key),
    ),
    kind: pick(
      sp.kind,
      kindOptionsFor(side).map((o) => o.key),
    ),
  };
}

export type TxnFunnelCounts = Record<TxnTab, number>;
