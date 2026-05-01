import { PageShell } from "@/components/shell/PageShell";
import { createClient } from "@/lib/supabase/server";
import { listLedgerView } from "@/lib/queries/transactions";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import { LedgerClient } from "./LedgerClient";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = await createClient();
  const rows = await listLedgerView(supabase, {
    entity,
    range: { from: period.from, to: period.to },
  });

  return (
    <PageShell
      page="ledger"
      title="Ledger"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity} · ${rows.length} entries`}
    >
      <LedgerClient rows={rows} />
    </PageShell>
  );
}
