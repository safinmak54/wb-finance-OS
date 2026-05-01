import { PageShell } from "@/components/shell/PageShell";
import { createClient } from "@/lib/supabase/server";
import { listBankConnections } from "@/lib/queries/cash";
import { BanksClient } from "./BanksClient";

export const dynamic = "force-dynamic";

export default async function BanksPage() {
  const supabase = await createClient();
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
