import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listUnclassifiedCC } from "@/lib/queries/transactions";
import { listAccounts } from "@/lib/queries/accounts";
import { entityCodeToId, listEntities } from "@/lib/queries/entities";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { InboxClient } from "../inbox/InboxClient";

export const dynamic = "force-dynamic";

export default async function CcInboxPage({
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

  const [rows, accounts, entities] = await Promise.all([
    listUnclassifiedCC(supabase, { entity, codeToId }),
    listAccounts(supabase, { activeOnly: true }),
    listEntities(supabase),
  ]);

  return (
    <PageShell
      page="cc-inbox"
      title="Credit Card Transactions"
      subtitle={`${rows.length} to classify · ${entity === "all" ? "All entities" : entity}`}
    >
      <InboxClient
        rows={rows.map((r) => ({
          ...r,
          entity_code: r.entity_id ? idToCode[r.entity_id] ?? null : null,
        }))}
        accounts={accounts}
        entities={entities.map((e) => ({ id: e.id, code: e.code }))}
      />
    </PageShell>
  );
}
