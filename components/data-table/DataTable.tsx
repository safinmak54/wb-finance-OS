"use client";

import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";

type Props<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  searchPlaceholder?: string;
  initialPageSize?: number;
  emptyMessage?: string;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  toolbar?: React.ReactNode;
};

export function DataTable<T>({
  columns,
  data,
  searchPlaceholder = "Search…",
  initialPageSize = 50,
  emptyMessage = "No rows.",
  className,
  rowClassName,
  toolbar,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize } },
  });

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 w-64 rounded-md border border-border bg-surface px-2.5 text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        {toolbar}
        <span className="ml-auto text-[11px] text-muted">
          {table.getFilteredRowModel().rows.length} rows
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      className={cn(
                        "select-none whitespace-nowrap px-3 py-2 text-left font-medium",
                        canSort && "cursor-pointer hover:text-foreground",
                      )}
                      onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                    >
                      {h.isPlaceholder
                        ? null
                        : flexRender(h.column.columnDef.header, h.getContext())}
                      {dir === "asc" ? " ▲" : dir === "desc" ? " ▼" : ""}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-t border-border hover:bg-surface-2",
                    rowClassName?.(row.original),
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="whitespace-nowrap px-3 py-2 align-middle"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {table.getPageCount() > 1 ? (
        <div className="flex items-center justify-end gap-3 text-[11px] text-muted">
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="rounded border border-border bg-surface px-2 py-1 hover:bg-surface-2 disabled:opacity-40"
          >
            ‹ Prev
          </button>
          <span>
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </span>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="rounded border border-border bg-surface px-2 py-1 hover:bg-surface-2 disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
