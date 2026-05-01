import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import {
  listJournals,
  listJeTaggedTransactions,
  type JournalRow,
} from "@/lib/queries/journals";
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

  const supabase = createDataClient();
  const [journals, jeTagged, accounts, entities] = await Promise.all([
    listJournals(supabase, {
      entity,
      range: { from: period.from, to: period.to },
    }),
    listJeTaggedTransactions(supabase, {
      entity,
      range: { from: period.from, to: period.to },
    }),
    listAccounts(supabase, { activeOnly: true }),
    listEntities(supabase),
  ]);

  // Merge: surface je-tagged transactions whose JE id isn't already loaded
  // (mirrors legacy renderJournals fallback at app.js:1563–1581).
  const seenJeIds = new Set(journals.map((j) => j.id));
  const synthetic: JournalRow[] = [];
  for (const t of jeTagged) {
    const jeId = (t.memo ?? "").replace(/^je:/, "");
    if (!jeId || seenJeIds.has(jeId) || !t.account_id) continue;
    seenJeIds.add(jeId);
    const amt = Number(t.amount ?? 0);
    synthetic.push({
      id: jeId,
      entity: null,
      entity_id: null,
      transaction_date: null,
      accounting_date: t.acc_date,
      description: t.description ?? "",
      entry_type: "journal",
      period: t.acc_date.slice(0, 7),
      source: null,
      status: "POSTED",
      is_intercompany: null,
      ledger_entries: [
        {
          debit_amount: amt < 0 ? Math.abs(amt) : 0,
          credit_amount: amt > 0 ? amt : 0,
          memo: t.description,
          account_id: t.account_id,
          accounts: t.accounts
            ? {
                account_code: t.accounts.account_code,
                account_name: t.accounts.account_name,
                account_type: "expense",
                account_subtype: null,
              }
            : null,
        },
      ],
    });
  }

  const merged = [...journals, ...synthetic].sort((a, b) =>
    a.accounting_date < b.accounting_date ? 1 : -1,
  );

  return (
    <PageShell
      page="journals"
      title="Journal Entries"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity} · ${merged.length} entries`}
    >
      <JournalsClient
        journals={merged}
        accounts={accounts}
        entities={entities.map((e) => ({ id: e.id, code: e.code }))}
        period={period.from.slice(0, 7)}
      />
    </PageShell>
  );
}
