import type { ReactNode } from "react";
import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  listUnclassifiedBank,
  listUnclassifiedCC,
  listClassifiedBank,
  listClassifiedCC,
  countRawBySide,
  postedMetaForRawIds,
  type RawListOpts,
  type RawTxnRow,
  type TxnSide,
} from "@/lib/queries/transactions";
import { listAccounts } from "@/lib/queries/accounts";
import { listBankConnections } from "@/lib/queries/cash";
import { entityCodeToId, listEntities } from "@/lib/queries/entities";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { listClassificationRules } from "@/lib/queries/classify";
import { classifyMany, detectTxnKind, type TxnKind } from "@/lib/classify-rules";
import { recentMonths, resolvePeriod } from "@/lib/period";
import { InboxClient } from "@/app/(app)/inbox/InboxClient";
import { TxnFunnelCards } from "@/components/transactions/TxnFunnelCards";
import { TxnRowFilters } from "@/components/transactions/TxnRowFilters";
import {
  resolveTxnView,
  type TxnFunnelCounts,
  type TxnKindFilter,
  type TxnStatus,
  type TxnTab,
} from "@/components/transactions/txn-tabs";
import { FinalizedTable } from "@/components/transactions/FinalizedTable";

type SearchParams = Record<string, string | string[] | undefined>;

/** Does a row pass the set-aside chip row? A cleared row (`null`) passes
 *  everything. */
function kindOk(kind: TxnKind, filter: TxnKindFilter | null): boolean {
  if (!filter) return true;
  if (filter === "set_aside") return kind !== "other";
  return kind === filter;
}

/** Shared body for the bank ("inbox") and credit-card ("cc-inbox") pages.
 *  Three independent controls resolve from the URL — the five funnel cards
 *  (`?tab=`), the status chips (`?status=`), the set-aside chips (`?kind=`) —
 *  plus a month window; the matching rows render as the classify inbox (open
 *  rows) and/or the finalized table. */
export async function TransactionsPage({
  side,
  page,
  title,
  searchParams,
}: {
  side: TxnSide;
  page: "inbox" | "cc-inbox";
  title: string;
  searchParams: SearchParams;
}) {
  const sp = searchParams;
  const entity = entityFilterFromSearchParams(sp);
  const { tab, status, kind } = resolveTxnView(sp, side);

  // Every view defaults to "All months" so nothing is ever silently hidden;
  // the month picker is opt-in narrowing. `period=all` is the explicit sentinel.
  const periodParam = typeof sp.period === "string" ? sp.period : null;
  const periodKey = periodParam ?? "all";
  const resolved = periodKey === "all" ? null : resolvePeriod({ key: periodKey });
  const range = resolved ? { from: resolved.from, to: resolved.to } : undefined;
  const periodLabel = resolved ? resolved.label : "All months";

  const months = [{ key: "all", label: "All months" }, ...recentMonths(12)];

  const supabase = createDataClient();
  const codeToId = await entityCodeToId(supabase);
  const idToCode: Record<string, string> = {};
  for (const [code, id] of Object.entries(codeToId)) idToCode[id] = code;

  const listOpts: RawListOpts = { entity, codeToId, range };
  const listOpen = side === "bank" ? listUnclassifiedBank : listUnclassifiedCC;
  const listFinal = side === "bank" ? listClassifiedBank : listClassifiedCC;

  // Finalized rows are only reachable from the All and Set Aside cards — the
  // other three describe work that hasn't been posted yet — so the heavier
  // row fetch is skipped there. The All card's total still needs a count,
  // which is one cheap head query.
  const needFinalRows = tab === "all" || tab === "set_aside";

  const [rows, accounts, entities, rules, banks, finalizedTotal, finalRaw] =
    await Promise.all([
      listOpen(supabase, listOpts),
      listAccounts(supabase, { activeOnly: true }),
      listEntities(supabase),
      listClassificationRules(supabase),
      listBankConnections(supabase),
      countRawBySide(supabase, side, true, listOpts),
      needFinalRows
        ? listFinal(supabase, listOpts)
        : Promise.resolve([] as RawTxnRow[]),
    ]);

  const classified = classifyMany(rows, rules);
  const autoTags: Record<string, { accountId: string }> = {};
  for (const [id, hit] of classified) {
    if (hit.accountId) autoTags[id] = { accountId: hit.accountId };
  }

  const enrich = (r: RawTxnRow) => {
    const entity_code = r.entity_id ? idToCode[r.entity_id] ?? null : null;
    return { ...r, entity_code, kind: detectTxnKind({ ...r, entity_code }) };
  };
  const openRows = rows.map(enrich);
  const finalRows = finalRaw.map(enrich);

  // The funnel: open rows split into set-aside kinds (transfers / card
  // payments, which never post) and rows genuinely waiting for an account;
  // that second group splits again by whether a rule matched. Card counts are
  // deliberately independent of the chip rows — they are the fixed funnel.
  const setAsideRows = openRows.filter((r) => r.kind !== "other");
  const toClassifyRows = openRows.filter((r) => r.kind === "other");
  const counts: TxnFunnelCounts = {
    all: openRows.length + finalizedTotal,
    set_aside: setAsideRows.length,
    to_classify: toClassifyRows.length,
    auto: toClassifyRows.filter((r) => autoTags[r.id]).length,
    manual: toClassifyRows.filter((r) => !autoTags[r.id]).length,
  };

  // The card picks which open rows are in play…
  const cardOpen = ((t: TxnTab) => {
    switch (t) {
      case "set_aside":
        return setAsideRows;
      case "to_classify":
        return toClassifyRows;
      case "auto":
        return toClassifyRows.filter((r) => autoTags[r.id]);
      case "manual":
        return toClassifyRows.filter((r) => !autoTags[r.id]);
      default:
        return openRows;
    }
  })(tab);

  // …and which finalized rows, if any. Auto-tagged / Manual describe a
  // pre-posting state, so they have no finalized side.
  const cardFinal =
    tab === "all"
      ? finalRows
      : tab === "set_aside"
        ? finalRows.filter((r) => r.kind !== "other")
        : [];

  // Chip counts are intersected with the card *and* the other row's chip, so
  // a chip that would land on an empty table says so up front.
  const statusCounts: Record<TxnStatus, number> = {
    to_classify: cardOpen.filter((r) => kindOk(r.kind, kind)).length,
    finalized: cardFinal.filter((r) => kindOk(r.kind, kind)).length,
  };
  const kindScope =
    status === "finalized"
      ? cardFinal
      : status === "to_classify"
        ? cardOpen
        : [...cardOpen, ...cardFinal];
  const kindCounts: Record<TxnKindFilter, number> = {
    set_aside: kindScope.filter((r) => r.kind !== "other").length,
    transfer: kindScope.filter((r) => r.kind === "transfer").length,
    cc_payment: kindScope.filter((r) => r.kind === "cc_payment").length,
  };

  // Status chip decides which blocks render; cleared means "both, if the card
  // has both".
  const showOpen = status !== "finalized";
  const showFinal =
    status === "finalized" || (status === null && cardFinal.length > 0);
  const showBothSections = showOpen && showFinal;

  const visibleOpen = cardOpen.filter((r) => kindOk(r.kind, kind));
  const visibleFinal = cardFinal.filter((r) => kindOk(r.kind, kind));
  const sources = Array.from(new Set(rows.map((r) => r.source))).sort();

  const openBlock = showOpen ? (
    <InboxClient
      rows={visibleOpen}
      accounts={accounts}
      entities={entities.map((e) => ({ id: e.id, code: e.code }))}
      autoTags={autoTags}
      sources={sources}
      banks={banks}
      entityFilter={typeof sp.entity === "string" ? sp.entity : undefined}
      showInternalTransfer={side === "bank"}
    />
  ) : null;

  // Finalized block — read-only, with Unfinalize.
  let finalizedBlock: ReactNode = null;
  if (showFinal) {
    const posted = await postedMetaForRawIds(
      supabase,
      visibleFinal.map((r) => r.id),
    );
    finalizedBlock = <FinalizedTable rows={visibleFinal} posted={posted} />;
  }

  const entityLabel = entity === "all" ? "All entities" : entity;
  const periodSuffix = periodKey === "all" ? "" : ` · ${periodLabel}`;

  return (
    <PageShell
      page={page}
      title={title}
      subtitle={`${counts.to_classify} to classify · ${entityLabel}${periodSuffix}`}
    >
      <TxnFunnelCards tab={tab} counts={counts} side={side} />
      <TxnRowFilters
        status={status}
        kind={kind}
        statusCounts={statusCounts}
        kindCounts={kindCounts}
        side={side}
        periodKey={periodKey}
        months={months}
      />
      {showBothSections ? (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Remaining
            </h3>
            {openBlock}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Finalized
            </h3>
            {finalizedBlock}
          </section>
        </div>
      ) : (
        <>
          {openBlock}
          {finalizedBlock}
        </>
      )}
    </PageShell>
  );
}
