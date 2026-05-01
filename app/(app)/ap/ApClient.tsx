"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDate } from "@/lib/format";
import { recordPayment } from "@/actions/invoices";
import { cn } from "@/lib/utils/cn";
import type { InvoiceWithVendor } from "@/lib/queries/invoices";

type Props = { invoices: InvoiceWithVendor[]; today: string };

export function ApClient({ invoices, today }: Props) {
  const toast = useToast();
  const [paying, setPaying] = useState<InvoiceWithVendor | null>(null);

  const columns = useMemo<ColumnDef<InvoiceWithVendor>[]>(
    () => [
      {
        accessorFn: (r) => r.vendors?.name ?? "—",
        id: "vendor",
        header: "Vendor",
      },
      { accessorKey: "invoice_number", header: "Number" },
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
        header: "Total",
        cell: (c) => <span className="font-mono">{fmt(c.getValue<number>())}</span>,
      },
      {
        accessorKey: "amount_paid",
        header: "Paid",
        cell: (c) => (
          <span className="font-mono text-success">
            {fmt(c.getValue<number>() ?? 0)}
          </span>
        ),
      },
      {
        accessorFn: (r) => Number(r.amount) - Number(r.amount_paid ?? 0),
        id: "remaining",
        header: "Remaining",
        cell: (c) => (
          <span className="font-mono font-semibold">{fmt(c.getValue<number>())}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: (c) => (
          <button
            type="button"
            className="text-[11px] font-medium text-info hover:underline"
            onClick={() => setPaying(c.row.original)}
          >
            Pay
          </button>
        ),
      },
    ],
    [today],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={invoices}
        searchPlaceholder="Search payables…"
      />

      <PayModal
        key={paying?.id ?? "pay-empty"}
        open={paying !== null}
        invoice={paying}
        onClose={() => setPaying(null)}
        onSubmitted={() => {
          setPaying(null);
          toast.push("Payment recorded", "success");
        }}
      />
    </>
  );
}

function PayModal({
  open,
  invoice,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  invoice: InvoiceWithVendor | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const remaining = invoice
    ? Number(invoice.amount) - Number(invoice.amount_paid ?? 0)
    : 0;
  const [amount, setAmount] = useState(String(remaining));
  const [error, setError] = useState<string | null>(null);

  if (!invoice) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await recordPayment({ id: invoice!.id, amount_paid: Number(amount) });
      onSubmitted();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Pay ${invoice.invoice_number}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="rounded-md bg-surface-2 p-3 text-xs">
          <div>Vendor: <strong>{invoice.vendors?.name}</strong></div>
          <div>Remaining: <span className="font-mono">{fmt(remaining)}</span></div>
        </div>
        <Field label="Payment amount">
          <TextInput
            type="number"
            required
            min="0"
            max={String(remaining)}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {error ? <div className="text-[11px] text-danger">{error}</div> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Record payment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
