import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listClassificationRules } from "@/lib/queries/classify";
import { listAccounts } from "@/lib/queries/accounts";
import { RulesClient } from "./RulesClient";

export const dynamic = "force-dynamic";

export default async function AdminRulesPage() {
  const supabase = createDataClient();
  const [rules, accounts] = await Promise.all([
    listClassificationRules(supabase),
    listAccounts(supabase, { activeOnly: true }),
  ]);

  return (
    <PageShell
      page="admin-rules"
      title="Classification Rules"
      subtitle="Pattern-based rules that pre-tag bank/CC transactions in the inbox"
    >
      <RulesClient
        rules={rules}
        accounts={accounts.map((a) => ({
          id: a.id,
          code: a.account_code,
          name: a.account_name,
          type: a.account_type,
        }))}
      />
    </PageShell>
  );
}
