"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { unfinalizeTransaction } from "@/actions/transactions";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { PostedMeta } from "@/lib/queries/transactions";
import type { RawTransaction } from "@/lib/supabase/types";

export type FinalizedRow = RawTransaction & { entity_code: string | null };

type Props = {
  rows: FinalizedRow[];
  posted: Record<string, PostedMeta>;
};

export function FinalizedTable({ rows, posted }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [busyRow, setBusyRow] = useState<string | null>(null);

  function onUnfinalize(r: FinalizedRow) {
    if (
      !confirm(
        "Unfinalize this transaction? It moves back to the To classify tab and its posted ledger entry is removed.",
      )
    )
      return;
    setBusyRow(r.id);
    startTransition(async () => {
      try {
        await unfinalizeTransaction({ rawId: r.id });
        toast.push("Moved back to To classify", "success");
        router.refresh();
      } catch (err) {
        toast.push((err as Error).message, "error");
      } finally {
        setBusyRow(null);
      }
    });
  }

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
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-muted">
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
              const rowBusy = isPending && busyRow === r.id;
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
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={rowBusy}
                      disabled={isPending}
                      onClick={() => onUnfinalize(r)}
                    >
                      Unfinalize
                    </Button>
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
