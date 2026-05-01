import { PageShell } from "@/components/shell/PageShell";
import { createClient } from "@/lib/supabase/server";
import { listAccountsWithBalances } from "@/lib/queries/accounts";
import { periodFromSearchParams } from "@/lib/period";
import { CoaClient } from "./CoaClient";

export const dynamic = "force-dynamic";

export default async function CoaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const supabase = await createClient();
  const accounts = await listAccountsWithBalances(supabase, {
    from: period.from,
    to: period.to,
  });

  return (
    <PageShell
      page="coa"
      title="Chart of Accounts"
      subtitle={`Live balances · ${period.label}`}
    >
      <CoaClient accounts={accounts} />
    </PageShell>
  );
}
