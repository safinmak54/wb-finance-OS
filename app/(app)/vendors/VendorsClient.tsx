"use client";

import { useMemo, useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { createVendor, updateVendor, deleteVendor } from "@/actions/vendors";
import type { Vendor } from "@/lib/supabase/types";

type Props = { vendors: Vendor[] };

const STATUS_BADGE: Record<string, string> = {
  active: "bg-success-soft text-success",
  overdue: "bg-danger-soft text-danger",
  inactive: "bg-surface-2 text-muted",
};

export function VendorsClient({ vendors }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const columns = useMemo<ColumnDef<Vendor>[]>(
    () => [
      { accessorKey: "name", header: "Vendor" },
      {
        accessorKey: "ytd_spend",
        header: "YTD spend",
        cell: (c) => (
          <span className="font-mono">{fmt(c.getValue<number>())}</span>
        ),
      },
      {
        accessorKey: "open_invoices",
        header: "Open",
        cell: (c) => c.getValue<number>() ?? 0,
      },
      {
        accessorKey: "overdue_count",
        header: "Overdue",
        cell: (c) => {
          const v = c.getValue<number>() ?? 0;
          return v > 0 ? (
            <span className="font-semibold text-danger">{v}</span>
          ) : (
            "—"
          );
        },
      },
      {
        accessorKey: "last_payment",
        header: "Last payment",
        cell: (c) => fmtDate(c.getValue<string>()),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (c) => {
          const v = c.getValue<string>() ?? "active";
          return (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
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
        cell: (c) => (
          <button
            type="button"
            className="text-[11px] font-medium text-info hover:underline"
            onClick={() => setEditing(c.row.original)}
          >
            Edit
          </button>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={vendors}
        searchPlaceholder="Search vendors…"
        toolbar={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            + Add vendor
          </Button>
        }
        rowClassName={(r) => (r.is_active ? undefined : "opacity-50")}
      />

      <VendorFormModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmitted={() => {
          setShowAdd(false);
          toast.push("Vendor created", "success");
        }}
        mode="create"
      />

      <VendorFormModal
        key={editing?.id ?? "edit-empty"}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSubmitted={() => {
          setEditing(null);
          toast.push("Vendor updated", "success");
        }}
        mode="edit"
        initial={editing}
      />
    </>
  );
}

type FormProps = {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  mode: "create" | "edit";
  initial?: Vendor | null;
};

function VendorFormModal({ open, onClose, onSubmitted, mode, initial }: FormProps) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState(initial?.status ?? "active");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          name,
          status,
        };
        if (mode === "create") {
          await createVendor(payload);
        } else if (initial) {
          await updateVendor({ id: initial.id, ...payload });
        }
        onSubmitted();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(`Deactivate ${initial.name}?`)) return;
    try {
      await deleteVendor(initial.id);
      onSubmitted();
      toast.push("Vendor deactivated", "success");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add vendor" : "Edit vendor"}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label="Name">
          <TextInput
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="overdue">Overdue</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>

        {error ? <div className="text-[11px] text-danger">{error}</div> : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          {mode === "edit" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-danger"
              disabled={pending}
            >
              Deactivate
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
