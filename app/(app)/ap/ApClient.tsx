"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDate } from "@/lib/format";
import { payApItem } from "@/actions/ap";
import { cn } from "@/lib/utils/cn";
import type { ApItemView } from "@/lib/supabase/types";

type Props = { items: ApItemView[]; today: string };

export function ApClient({ items, today }: Props) {
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function onPay(item: ApItemView) {
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

  const columns = useMemo<ColumnDef<ApItemView>[]>(
    () => [
      {
        accessorKey: "vendor_name",
        header: "Vendor",
        cell: (c) => c.getValue<string | null>() ?? "—",
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
            days <= 0
              ? "Current"
              : days <= 30
                ? "1–30d"
                : days <= 60
                  ? "31–60d"
                  : days <= 90
                    ? "61–90d"
                    : "90+d";
          const tone =
            days <= 0
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
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today, pendingId],
  );

  return (
    <DataTable
      columns={columns}
      data={items}
      searchPlaceholder="Search payables…"
    />
  );
}
