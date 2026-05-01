import { PageShell } from "@/components/shell/PageShell";
import { createClient } from "@/lib/supabase/server";
import { listJournals } from "@/lib/queries/journals";
import { listAccounts } from "@/lib/queries/accounts";
import { listEntities } from "@/lib/queries/entities";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import { JournalsClient } from "./JournalsClient";

export const dynamic = "force-dynamic";

export default async function JournalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = await createClient();
  const [journals, accounts, entities] = await Promise.all([
    listJournals(supabase, {
      entity,
      range: { from: period.from, to: period.to },
    }),
    listAccounts(supabase, { activeOnly: true }),
    listEntities(supabase),
  ]);

  return (
    <PageShell
      page="journals"
      title="Journal Entries"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity} · ${journals.length} entries`}
    >
      <JournalsClient
        journals={journals}
        accounts={accounts}
        entities={entities.map((e) => ({ id: e.id, code: e.code }))}
        period={period.from.slice(0, 7)}
      />
    </PageShell>
  );
}
