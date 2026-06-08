"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { useToast } from "@/components/ui/Toast";
import { EditableDateCell } from "@/components/transactions/EditableDateCell";
import { editTransaction } from "@/actions/transactions";
import { fmt } from "@/lib/format";
import type { LedgerRow } from "@/lib/queries/transactions";

type Props = { rows: LedgerRow[] };

export function LedgerClient({ rows }: Props) {
  const router = useRouter();
  const toast = useToast();

  const saveDate = useCallback(
    async (id: string, acc_date: string) => {
      try {
        await editTransaction({ id, acc_date });
        toast.push("Date updated", "success");
        router.refresh();
      } catch (err) {
        toast.push((err as Error).message, "error");
        throw err; // keep the inline editor open so the user can retry
      }
    },
    [router, toast],
  );

  const columns = useMemo<ColumnDef<LedgerRow>[]>(
    () => [
      {
        accessorKey: "acc_date",
        header: "Date",
        cell: (c) => {
          const row = c.row.original;
          return (
            <EditableDateCell
              date={row.acc_date}
              originalDate={row.txn_date}
              onSave={(d) => saveDate(row.id, d)}
            />
          );
        },
      },
      {
        accessorKey: "entity",
        header: "Entity",
        cell: (c) => (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase">
            {c.getValue<string>()}
          </span>
        ),
      },
      {
        accessorFn: (r) =>
          r.accounts ? `${r.accounts.account_code} · ${r.accounts.account_name}` : "—",
        id: "account",
        header: "Account",
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: (c) => (
          <span className="block max-w-[400px] truncate">
            {c.getValue<string>() ?? ""}
          </span>
        ),
      },
      {
        accessorKey: "amount",
        header: "Amount",
        cell: (c) => {
          const v = c.getValue<number>();
          return (
            <span
              className={
                v < 0
                  ? "font-mono text-danger"
                  : "font-mono text-success"
              }
            >
              {fmt(v)}
            </span>
          );
        },
      },
    ],
    [saveDate],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search ledger…"
      emptyMessage="No posted transactions in this period."
    />
  );
}
