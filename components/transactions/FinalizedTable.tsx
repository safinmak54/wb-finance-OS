import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { PostedMeta } from "@/lib/queries/transactions";
import type { RawTransaction } from "@/lib/supabase/types";

export type FinalizedRow = RawTransaction & { entity_code: string | null };

type Props = {
  rows: FinalizedRow[];
  /** Posted account/entity keyed by raw_transaction_id (absent for rows marked
   *  as internal transfer / CC payment, which post no ledger row). */
  posted: Record<string, PostedMeta>;
};

/** Read-only list of already-finalized bank/CC rows for the selected month.
 *  Shows where each row landed (account + entity) or flags the no-ledger
 *  transfer / CC-payment rows. No classify affordances — finalized rows are
 *  not editable from here. */
export function FinalizedTable({ rows, posted }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-left">Entity</th>
            <th className="px-3 py-2 text-left">Account</th>
            <th className="px-3 py-2 text-left">Finalized</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-muted">
                No finalized transactions for this period.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const signed =
                r.direction === "DEBIT"
                  ? -Math.abs(Number(r.amount))
                  : Math.abs(Number(r.amount));
              const meta = posted[r.id];
              const entity = meta?.entity ?? r.entity_code ?? "—";
              const account = meta?.account_code
                ? `${meta.account_code} · ${meta.account_name ?? ""}`.trim()
                : null;
              return (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {String(r.accounting_date ?? r.transaction_date)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="block max-w-[300px] truncate">
                      {r.description || <span className="text-muted">—</span>}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-1.5 text-right font-mono",
                      signed < 0 ? "text-danger" : "text-success",
                    )}
                  >
                    {fmt(signed)}
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-muted">
                    {r.source}
                  </td>
                  <td className="px-3 py-1.5">{entity}</td>
                  <td className="px-3 py-1.5">
                    {account ? (
                      account
                    ) : (
                      <span className="text-[11px] italic text-muted">
                        Transfer / CC payment
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-[11px] text-muted">
                    {r.classified_at
                      ? String(r.classified_at).slice(0, 10)
                      : "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
