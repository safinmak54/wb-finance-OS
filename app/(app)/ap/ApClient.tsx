"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDate } from "@/lib/format";
import { payApItem, disputeApItem } from "@/actions/ap";
import { cn } from "@/lib/utils/cn";
import type { ApItem } from "@/lib/supabase/types";

type Props = { items: ApItem[]; today: string };

export function ApClient({ items, today }: Props) {
  const toast = useToast();
  const [disputing, setDisputing] = useState<ApItem | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function onPay(item: ApItem) {
    setPendingId(item.id);
    try {
      await payApItem({ id: item.id });
      toast.push("Marked as paid", "success");
    } catch (err) {
      toast.push((err as Error).message, "error");
    } finally {
      setPendingId(null);
    }
  }

  const columns = useMemo<ColumnDef<ApItem>[]>(
    () => [
      {
        accessorKey: "vendor",
        header: "Vendor",
      },
      { accessorKey: "entity", header: "Entity" },
      {
        accessorKey: "invoice_date",
        header: "Invoice date",
        cell: (c) => {
          const d = c.getValue<string | null>();
          return (
            <span className="font-mono text-[11px]">{d ? fmtDate(d) : "—"}</span>
          );
        },
      },
      {
        accessorKey: "due_date",
        header: "Due",
        cell: (c) => {
          const d = c.getValue<string>();
          const overdue = d < today;
          return (
            <span className={cn("font-mono text-[11px]", overdue && "text-danger")}>
              {fmtDate(d)}
              {overdue ? " (overdue)" : ""}
            </span>
          );
        },
      },
      {
        accessorKey: "amount",
        header: "Amount",
        cell: (c) => (
          <span className="font-mono font-semibold">
            {fmt(c.getValue<number>())}
          </span>
        ),
      },
      {
        id: "aging",
        header: "Aging",
        cell: (c) => {
          const due = c.row.original.due_date;
          const days = Math.floor(
            (new Date(today).getTime() - new Date(due).getTime()) / 86400000,
          );
          const label =
            days < 0
              ? "Current"
              : days <= 30
                ? "1–30d"
                : days <= 60
                  ? "31–60d"
                  : days <= 90
                    ? "61–90d"
                    : "90+d";
          const tone =
            days < 0
              ? "text-success"
              : days <= 60
                ? "text-warning"
                : "text-danger";
          return <span className={cn("text-[11px] font-medium", tone)}>{label}</span>;
        },
      },
      {
        id: "actions",
        header: "",
        cell: (c) => (
          <div className="flex gap-2">
            <button
              type="button"
              className="text-[11px] font-medium text-info hover:underline disabled:opacity-50"
              disabled={pendingId === c.row.original.id}
              onClick={() => onPay(c.row.original)}
            >
              {pendingId === c.row.original.id ? "Saving…" : "Pay"}
            </button>
            <button
              type="button"
              className="text-[11px] font-medium text-warning hover:underline"
              onClick={() => setDisputing(c.row.original)}
            >
              Dispute
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today, pendingId],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={items}
        searchPlaceholder="Search payables…"
      />

      <DisputeModal
        key={disputing?.id ?? "dispute-empty"}
        open={disputing !== null}
        item={disputing}
        onClose={() => setDisputing(null)}
        onSubmitted={() => {
          setDisputing(null);
          toast.push("Dispute note saved", "success");
        }}
      />
    </>
  );
}

function DisputeModal({
  open,
  item,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  item: ApItem | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [note, setNote] = useState(item?.dispute_note ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!item) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await disputeApItem({ id: item!.id, note });
      onSubmitted();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Dispute · ${item.vendor}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="rounded-md bg-surface-2 p-3 text-xs">
          <div>Vendor: <strong>{item.vendor}</strong></div>
          <div>Amount: <span className="font-mono">{fmt(item.amount)}</span></div>
          <div>Due: <span className="font-mono">{item.due_date}</span></div>
        </div>
        <Field label="Dispute note">
          <TextInput
            required
            minLength={1}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error ? <div className="text-[11px] text-danger">{error}</div> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Save note
          </Button>
        </div>
      </form>
    </Modal>
  );
}
