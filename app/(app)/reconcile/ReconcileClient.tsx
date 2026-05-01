"use client";

import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDateShort } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { markMatched, unmatch } from "@/actions/reconcile";

type Side = {
  id: string;
  date: string;
  description: string;
  amount: number;
  matched: boolean;
  account?: string;
};

type Props = {
  bank: Side[];
  book: Side[];
};

export function ReconcileClient({ bank, book }: Props) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [selectedBank, setSelectedBank] = useState<Side | null>(null);
  const [selectedBook, setSelectedBook] = useState<Side | null>(null);

  function pair() {
    if (!selectedBank || !selectedBook) {
      toast.push("Select one row from each side", "error");
      return;
    }
    if (Math.abs(selectedBank.amount - selectedBook.amount) > 0.01) {
      if (
        !confirm(
          `Amounts differ: bank ${fmt(selectedBank.amount)} vs book ${fmt(selectedBook.amount)}. Match anyway?`,
        )
      ) {
        return;
      }
    }
    startTransition(async () => {
      try {
        await markMatched({
          statement_txn_id: selectedBank.id,
          book_txn_id: selectedBook.id,
          amount: selectedBank.amount,
          match_status: "matched",
        });
        toast.push("Matched", "success");
        setSelectedBank(null);
        setSelectedBook(null);
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  async function onUnmatch(bankId: string) {
    if (!confirm("Remove this match?")) return;
    try {
      await unmatch(bankId);
      toast.push("Unmatched", "success");
    } catch (err) {
      toast.push((err as Error).message, "error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2">
        <div className="text-xs text-muted">
          Click a row on each side, then click <strong>Match</strong>.
        </div>
        <Button size="sm" onClick={pair} disabled={!selectedBank || !selectedBook}>
          Match
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SideColumn
          title="Bank statement"
          rows={bank}
          selectedId={selectedBank?.id}
          onSelect={(r) => setSelectedBank((s) => (s?.id === r.id ? null : r))}
          onUnmatch={onUnmatch}
        />
        <SideColumn
          title="Book / ledger"
          rows={book}
          selectedId={selectedBook?.id}
          onSelect={(r) => setSelectedBook((s) => (s?.id === r.id ? null : r))}
        />
      </div>
    </div>
  );
}

function SideColumn({
  title,
  rows,
  selectedId,
  onSelect,
  onUnmatch,
}: {
  title: string;
  rows: Side[];
  selectedId: string | undefined;
  onSelect: (r: Side) => void;
  onUnmatch?: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={`${rows.length} rows`} />
      <CardBody className="max-h-[600px] overflow-y-auto p-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase text-muted">
            <tr>
              <th className="px-3 py-1.5 text-left">Date</th>
              <th className="px-3 py-1.5 text-left">Description</th>
              <th className="px-3 py-1.5 text-right">Amount</th>
              <th className="px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={cn(
                  "cursor-pointer border-t border-border hover:bg-surface-2",
                  selectedId === r.id && "bg-info-soft",
                  r.matched && "opacity-60",
                )}
                onClick={() => onSelect(r)}
              >
                <td className="px-3 py-1 font-mono text-[11px]">
                  {fmtDateShort(r.date)}
                </td>
                <td className="px-3 py-1">
                  <div className="max-w-[300px] truncate">{r.description}</div>
                  {r.account ? (
                    <div className="text-[10px] text-muted">{r.account}</div>
                  ) : null}
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-1 text-right font-mono",
                    r.amount < 0 ? "text-danger" : "text-success",
                  )}
                >
                  {fmt(r.amount)}
                </td>
                <td className="px-3 py-1">
                  {r.matched ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnmatch?.(r.id);
                      }}
                      className="text-[10px] text-info hover:underline"
                    >
                      ✓
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
