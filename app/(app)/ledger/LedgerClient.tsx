"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { fmt, fmtDateShort } from "@/lib/format";
import type { LedgerRow } from "@/lib/queries/transactions";

type Props = { rows: LedgerRow[] };

export function LedgerClient({ rows }: Props) {
  const columns = useMemo<ColumnDef<LedgerRow>[]>(
    () => [
      {
        accessorKey: "acc_date",
        header: "Date",
        cell: (c) => (
          <span className="font-mono text-[11px]">
            {fmtDateShort(c.getValue<string>())}
          </span>
        ),
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
    [],
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
