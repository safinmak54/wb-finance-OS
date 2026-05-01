"use client";

import { useMemo, useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDate, today } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { createInvoice, recordPayment, deleteInvoice } from "@/actions/invoices";
import type { Vendor } from "@/lib/supabase/types";
import type { InvoiceWithVendor } from "@/lib/queries/invoices";

type Props = {
  invoices: InvoiceWithVendor[];
  vendors: Vendor[];
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-info-soft text-info",
  partial: "bg-warning-soft text-warning",
  paid: "bg-success-soft text-success",
  overdue: "bg-danger-soft text-danger",
};

export function InvoicesClient({ invoices, vendors }: Props) {
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
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
        accessorKey: "invoice_date",
        header: "Date",
        cell: (c) => fmtDate(c.getValue<string>()),
      },
      {
        accessorKey: "due_date",
        header: "Due",
        cell: (c) => fmtDate(c.getValue<string>()),
      },
      {
        accessorKey: "amount",
        header: "Amount",
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
        accessorKey: "status",
        header: "Status",
        cell: (c) => {
          const v = c.getValue<string>();
          return (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                STATUS_BADGE[v] ?? "bg-surface-2 text-muted",
              )}
            >
              {v}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: (c) => {
          const inv = c.row.original;
          if (inv.status === "paid") return null;
          return (
            <button
              type="button"
              className="text-[11px] font-medium text-info hover:underline"
              onClick={() => setPaying(inv)}
            >
              Pay
            </button>
          );
        },
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={invoices}
        searchPlaceholder="Search invoices…"
        toolbar={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            + Add invoice
          </Button>
        }
      />

      <AddInvoiceModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        vendors={vendors}
        onSubmitted={() => {
          setShowAdd(false);
          toast.push("Invoice created", "success");
        }}
      />

      <PayInvoiceModal
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

function AddInvoiceModal({
  open,
  onClose,
  onSubmitted,
  vendors,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  vendors: Vendor[];
}) {
  const [pending, startTransition] = useTransition();
  const [vendorId, setVendorId] = useState("");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today());
  const [due, setDue] = useState(today());
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"open" | "partial" | "paid" | "overdue">("open");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createInvoice({
          vendor_id: vendorId,
          invoice_number: number,
          invoice_date: date,
          due_date: due,
          amount: Number(amount),
          status,
        });
        onSubmitted();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Add invoice">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label="Vendor">
          <Select required value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">— select —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Number">
            <TextInput
              required
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <Select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as typeof status)
              }
            >
              <option value="open">Open</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice date">
            <TextInput type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <TextInput type="date" required value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Amount">
          <TextInput
            type="number"
            required
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        {error ? <div className="text-[11px] text-danger">{error}</div> : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PayInvoiceModal({
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
  const [pending, startTransition] = useTransition();
  const remaining = invoice
    ? Number(invoice.amount) - Number(invoice.amount_paid ?? 0)
    : 0;
  const [amount, setAmount] = useState(String(remaining));
  const [error, setError] = useState<string | null>(null);

  if (!invoice) return null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await recordPayment({
          id: invoice!.id,
          amount_paid: Number(amount),
        });
        onSubmitted();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  async function onDelete() {
    if (!invoice) return;
    if (!confirm(`Delete invoice ${invoice.invoice_number}?`)) return;
    try {
      await deleteInvoice(invoice.id);
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
          <div>Total: <span className="font-mono">{fmt(Number(invoice.amount))}</span></div>
          <div>Already paid: <span className="font-mono text-success">{fmt(Number(invoice.amount_paid ?? 0))}</span></div>
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

        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-danger"
            disabled={pending}
          >
            Delete invoice
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Record payment
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
