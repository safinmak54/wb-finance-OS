import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listBankConnections } from "@/lib/queries/cash";
import { BanksClient } from "./BanksClient";

export const dynamic = "force-dynamic";

export default async function BanksPage() {
  const supabase = createDataClient();
  const banks = await listBankConnections(supabase);

  return (
    <PageShell
      page="banks"
      title="Bank Connections"
      subtitle={`${banks.length} ${banks.length === 1 ? "connection" : "connections"}`}
    >
      <BanksClient banks={banks} />
    </PageShell>
  );
}
