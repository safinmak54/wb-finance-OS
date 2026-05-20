import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  listUnclassifiedBank,
} from "@/lib/queries/transactions";
import { listAccounts } from "@/lib/queries/accounts";
import { listBankConnections } from "@/lib/queries/cash";
import { entityCodeToId, listEntities } from "@/lib/queries/entities";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { listClassificationRules } from "@/lib/queries/classify";
import { classifyMany, detectTxnKind } from "@/lib/classify-rules";
import { InboxClient } from "./InboxClient";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const entity = entityFilterFromSearchParams(sp);

  const supabase = createDataClient();
  const codeToId = await entityCodeToId(supabase);
  const idToCode: Record<string, string> = {};
  for (const [code, id] of Object.entries(codeToId)) idToCode[id] = code;

  const [rows, accounts, entities, rules, banks] = await Promise.all([
    listUnclassifiedBank(supabase, { entity, codeToId }),
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

  const enrichedRows = rows.map((r) => {
    const entity_code = r.entity_id ? idToCode[r.entity_id] ?? null : null;
    return {
      ...r,
      entity_code,
      kind: detectTxnKind({ ...r, entity_code }),
    };
  });

  const sources = Array.from(new Set(rows.map((r) => r.source))).sort();

  return (
    <PageShell
      page="inbox"
      title="Bank Transactions"
      subtitle={`${rows.length} to classify · ${entity === "all" ? "All entities" : entity}`}
    >
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
