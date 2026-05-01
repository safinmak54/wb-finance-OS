import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listCashBalances } from "@/lib/queries/cash";
import { CashBalancesClient } from "./CashBalancesClient";

export const dynamic = "force-dynamic";

export default async function CashBalancesPage() {
  const supabase = createDataClient();
  const rows = await listCashBalances(supabase);

  const latest = rows.reduce<string | null>((acc, r) => {
    if (!acc || (r.updated_at && r.updated_at > acc)) return r.updated_at;
    return acc;
  }, null);

  return (
    <PageShell
      page="cash-balances"
      title="Cash Balances"
      subtitle={
        latest
          ? `Manually updated · as of ${new Date(latest).toLocaleDateString()}`
          : "Manually updated"
      }
    >
      <CashBalancesClient rows={rows} />
    </PageShell>
  );
}
