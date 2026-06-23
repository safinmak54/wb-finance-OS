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
import { TxnViewControls } from "@/components/transactions/TxnViewControls";
import { FinalizedTable } from "@/components/transactions/FinalizedTable";

type SearchParams = Record<string, string | string[] | undefined>;

/** Shared body for the bank ("inbox") and credit-card ("cc-inbox") pages.
 *  Resolves the view (To classify / Finalized) and month window from the URL,
 *  fetches the matching rows, and renders the controls + the appropriate
 *  table. */
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
  const view = sp.view === "finalized" ? "finalized" : "open";

  // Both tabs default to "All months" so nothing is ever silently hidden; the
  // month picker is opt-in narrowing. `period=all` is the explicit sentinel.
  const periodParam = typeof sp.period === "string" ? sp.period : null;
  const periodKey = periodParam ?? "all";
  const resolved = periodKey === "all" ? null : resolvePeriod({ key: periodKey });
  const range = resolved ? { from: resolved.from, to: resolved.to } : undefined;
  const periodLabel = resolved ? resolved.label : "All months";

  const months = [
    { key: "all", label: "All months" },
    ...recentMonths(12),
  ];

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

  const controls = (
    <TxnViewControls
      view={view}
      periodKey={periodKey}
      months={months}
      openCount={openCount}
    />
  );

  if (view === "finalized") {
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

    return (
      <PageShell
        page={page}
        title={title}
        subtitle={`${rows.length} finalized · ${entityLabel} · ${periodLabel}`}
      >
        {controls}
        <FinalizedTable rows={enriched} posted={posted} />
      </PageShell>
    );
  }

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

  const enrichedRows = rows.map((r: RawTxnRow) => {
    const entity_code = r.entity_id ? idToCode[r.entity_id] ?? null : null;
    return { ...r, entity_code, kind: detectTxnKind({ ...r, entity_code }) };
  });

  const sources = Array.from(new Set(rows.map((r) => r.source))).sort();
  const periodSuffix = periodKey === "all" ? "" : ` · ${periodLabel}`;

  return (
    <PageShell
      page={page}
      title={title}
      subtitle={`${rows.length} shown · ${openCount} to classify · ${entityLabel}${periodSuffix}`}
    >
      {controls}
      <InboxClient
        rows={enrichedRows}
        accounts={accounts}
        entities={entities.map((e) => ({ id: e.id, code: e.code }))}
        autoTags={autoTags}
        sources={sources}
        banks={banks}
        entityFilter={typeof sp.entity === "string" ? sp.entity : undefined}
      />
    </PageShell>
  );
}
