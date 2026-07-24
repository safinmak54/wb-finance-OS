import { PageShell } from "@/components/shell/PageShell";
import { Placeholder } from "@/components/shell/Placeholder";

export const dynamic = "force-dynamic";

/**
 * Trial Balance (Epic 1 · Reports).
 *
 * Scaffolded for navigation + role gating only. The report itself — every
 * account with its debit/credit balance, proving total debits == total
 * credits — is intentionally deferred; this session ships the route with an
 * empty state so the Reports section is complete and reachable.
 */
export default function TrialBalancePage() {
  return (
    <PageShell
      page="trial-balance"
      title="Trial Balance"
      subtitle="All accounts with debit/credit balances"
    >
      <Placeholder
        title="Trial Balance coming soon"
        description="This report will list every account with its debit and credit balance and prove that total debits equal total credits. Wired for navigation and role gating; the report data is not connected yet."
      />
    </PageShell>
  );
}
