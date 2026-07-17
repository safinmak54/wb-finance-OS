import type { ReactNode } from "react";
import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  listUnclassifiedBank,
  listUnclassifiedCC,
  listClassifiedBank,
  listClassifiedCC,
  countUnclassifiedSide,
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
import { classifyMany, detectTxnKind } from "@/lib/classify-rules";
import { recentMonths, resolvePeriod } from "@/lib/period";
import { InboxClient } from "@/app/(app)/inbox/InboxClient";
import {
  TxnViewControls,
  type TxnTab,
} from "@/components/transactions/TxnViewControls";
import { FinalizedTable } from "@/components/transactions/FinalizedTable";

type SearchParams = Record<string, string | string[] | undefined>;

const TAB_VALUES: readonly TxnTab[] = [
  "all",
  "transfer",
  "cc_payment",
  "finalized",
  "remaining",
];

/** Shared body for the bank ("inbox") and credit-card ("cc-inbox") pages.
 *  A tab bar (All / Internal transaction / CC Payment / Finalised / Remaining)
 *  and month window are resolved from the URL; the matching rows are fetched
 *  and rendered as the classify inbox (open rows) and/or the finalized table. */
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

  let tab: TxnTab =
    typeof sp.tab === "string" && (TAB_VALUES as string[]).includes(sp.tab)
      ? (sp.tab as TxnTab)
      : "all";
  // Credit-card transactions have no "internal transfer" concept, so that
  // tab can't be selected there — fall back to All.
  if (side !== "bank" && tab === "transfer") tab = "all";

  // Both tabs default to "All months" so nothing is ever silently hidden; the
  // month picker is opt-in narrowing. `period=all` is the explicit sentinel.
  const periodParam = typeof sp.period === "string" ? sp.period : null;
  const periodKey = periodParam ?? "all";
  const resolved = periodKey === "all" ? null : resolvePeriod({ key: periodKey });
  const range = resolved ? { from: resolved.from, to: resolved.to } : undefined;
  const periodLabel = resolved ? resolved.label : "All months";

  const months = [{ key: "all", label: "All months" }, ...recentMonths(12)];

  const needOpen =
    tab === "all" ||
    tab === "remaining" ||
    tab === "transfer" ||
    tab === "cc_payment";
  const needFinalized = tab === "all" || tab === "finalized";

  const supabase = createDataClient();
  const codeToId = await entityCodeToId(supabase);
  const idToCode: Record<string, string> = {};
  for (const [code, id] of Object.entries(codeToId)) idToCode[id] = code;

  const listOpts: RawListOpts = { entity, codeToId, range };
  const openCount = await countUnclassifiedSide(supabase, side, {
    entity,
    codeToId,
  });

  const entityLabel = entity === "all" ? "All entities" : entity;
  const periodSuffix = periodKey === "all" ? "" : ` · ${periodLabel}`;

  const controls = (
    <TxnViewControls
      tab={tab}
      side={side}
      periodKey={periodKey}
      months={months}
      openCount={openCount}
    />
  );

  // Open (to-classify) block — the classify inbox. For the kind tabs it is
  // filtered down to that kind; "same as before" means remaining rows only.
  let openBlock: ReactNode = null;
  if (needOpen) {
    const listOpen = side === "bank" ? listUnclassifiedBank : listUnclassifiedCC;
    const [rows, accounts, entities, rules, banks] = await Promise.all([
      listOpen(supabase, listOpts),
      listAccounts(supabase, { activeOnly: true }),
      listEntities(supabase),
      listClassificationRules(supabase),
      listBankConnections(supabase),
    ]);

    const classified = classifyMany(rows, rules);
    const autoTags: Record<string, { accountId: string }> = {};
    for (const [id, hit] of classified) {
      if (hit.accountId) autoTags[id] = { accountId: hit.accountId };
    }

    let enrichedRows = rows.map((r: RawTxnRow) => {
      const entity_code = r.entity_id ? idToCode[r.entity_id] ?? null : null;
      return { ...r, entity_code, kind: detectTxnKind({ ...r, entity_code }) };
    });
    if (tab === "transfer") {
      enrichedRows = enrichedRows.filter((r) => r.kind === "transfer");
    } else if (tab === "cc_payment") {
      enrichedRows = enrichedRows.filter((r) => r.kind === "cc_payment");
    }

    const sources = Array.from(new Set(rows.map((r) => r.source))).sort();

    openBlock = (
      <InboxClient
        rows={enrichedRows}
        accounts={accounts}
        entities={entities.map((e) => ({ id: e.id, code: e.code }))}
        autoTags={autoTags}
        sources={sources}
        banks={banks}
        entityFilter={typeof sp.entity === "string" ? sp.entity : undefined}
        showInternalTransfer={side === "bank"}
      />
    );
  }

  // Finalized block — read-only, with Unfinalize.
  let finalizedBlock: ReactNode = null;
  if (needFinalized) {
    const listFinal = side === "bank" ? listClassifiedBank : listClassifiedCC;
    const rows = await listFinal(supabase, listOpts);
    const posted = await postedMetaForRawIds(
      supabase,
      rows.map((r) => r.id),
    );
    const enriched = rows.map((r) => ({
      ...r,
      entity_code: r.entity_id ? idToCode[r.entity_id] ?? null : null,
    }));
    finalizedBlock = <FinalizedTable rows={enriched} posted={posted} />;
  }

  return (
    <PageShell
      page={page}
      title={title}
      subtitle={`${openCount} to classify · ${entityLabel}${periodSuffix}`}
    >
      {controls}
      {tab === "all" ? (
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
