import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listRevenue, bucketByDay } from "@/lib/queries/sales";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import { SalesClient } from "./SalesClient";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = createDataClient();
  const txns = await listRevenue(supabase, {
    entity,
    from: period.from,
    to: period.to,
  });
  const byDay = bucketByDay(txns);
  const total = txns.reduce((s, t) => s + Number(t.amount ?? 0), 0);

  return (
    <PageShell
      page="sales"
      title="Sales Metrics"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity}`}
    >
      <SalesClient byDay={byDay} total={total} count={txns.length} />
    </PageShell>
  );
}
