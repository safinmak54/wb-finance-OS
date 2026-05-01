import { PageShell } from "@/components/shell/PageShell";
import { createClient } from "@/lib/supabase/server";
import { listLedgerView } from "@/lib/queries/transactions";
import { listReconciliationMatches } from "@/lib/queries/reconcile";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import { ReconcileClient } from "./ReconcileClient";

export const dynamic = "force-dynamic";

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = await createClient();
  const [bookSide, matches] = await Promise.all([
    listLedgerView(supabase, {
      entity,
      range: { from: period.from, to: period.to },
    }),
    listReconciliationMatches(supabase),
  ]);

  // Bank side from raw_transactions in the same range
  const { data: bankRows } = await supabase
    .from("raw_transactions")
    .select(
      "id, accounting_date, transaction_date, description, amount, direction, status, classified",
    )
    .gte("accounting_date", period.from)
    .lte("accounting_date", period.to)
    .order("accounting_date", { ascending: false });

  const matchedBankIds = new Set(matches.map((m) => m.statement_txn_id));
  const matchedBookIds = new Set(matches.map((m) => m.book_txn_id));

  return (
    <PageShell
      page="reconcile"
      title="Reconciliation"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity}`}
    >
      <ReconcileClient
        bank={(bankRows ?? []).map((r) => ({
          id: r.id,
          date: String(r.accounting_date ?? r.transaction_date ?? ""),
          description: r.description ?? "",
          amount:
            r.direction === "DEBIT"
              ? -Math.abs(Number(r.amount))
              : Math.abs(Number(r.amount)),
          matched: matchedBankIds.has(r.id),
        }))}
        book={bookSide.map((r) => ({
          id: r.id,
          date: r.acc_date,
          description: r.description ?? "",
          amount: Number(r.amount),
          account: r.accounts
            ? `${r.accounts.account_code} ${r.accounts.account_name}`
            : "",
          matched: matchedBookIds.has(r.id),
        }))}
      />
    </PageShell>
  );
}
