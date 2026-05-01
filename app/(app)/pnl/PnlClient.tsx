"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/Modal";
import { fmt, fmtPct, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { drillDownAccount } from "@/actions/reports";
import type { DrillDownTxn } from "@/lib/queries/transactions";

export type PnlLine = {
  accountId: string;
  label: string;
  amount: number;
};

export type PnlData = {
  revenue: { lines: PnlLine[]; total: number };
  cogs: { lines: PnlLine[]; total: number };
  expenses: { lines: PnlLine[]; total: number };
  totals: {
    grossProfit: number;
    netIncome: number;
    grossMargin: number;
    netMargin: number;
    adjustment: { revenue: number; cogs: number; expense: number };
  };
  range: { from: string; to: string };
  entity: string;
};

export function PnlClient({ data }: { data: PnlData }) {
  const [openLine, setOpenLine] = useState<PnlLine | null>(null);
  const [rows, setRows] = useState<DrillDownTxn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openDrill(line: PnlLine) {
    setOpenLine(line);
    setRows(null);
    setError(null);
    startTransition(async () => {
      try {
        const r = await drillDownAccount({
          accountId: line.accountId,
          from: data.range.from,
          to: data.range.to,
          entity: data.entity,
        });
        setRows(r);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section
          title="Revenue"
          lines={data.revenue.lines}
          total={data.revenue.total}
          totalLabel="Total revenue"
          onClick={openDrill}
        />
        <Section
          title="Cost of goods sold"
          lines={data.cogs.lines}
          total={data.cogs.total}
          totalLabel="Total COGS"
          onClick={openDrill}
        />
        <Section
          title="Operating expenses"
          lines={data.expenses.lines}
          total={data.expenses.total}
          totalLabel="Total OpEx"
          onClick={openDrill}
        />
        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-4 shadow-card">
          <Row label="Revenue" value={data.revenue.total} />
          <Row label="COGS" value={-data.cogs.total} />
          <Row
            label="Gross profit"
            value={data.totals.grossProfit}
            sub={`${fmtPct(data.totals.grossMargin)} margin`}
            emphasis
          />
          <Row label="Operating expenses" value={-data.expenses.total} />
          {(data.totals.adjustment.revenue !== 0 ||
            data.totals.adjustment.cogs !== 0 ||
            data.totals.adjustment.expense !== 0) && (
            <Row
              label="Adjusting JEs"
              value={
                data.totals.adjustment.revenue -
                data.totals.adjustment.cogs -
                data.totals.adjustment.expense
              }
              sub="From journal entries"
            />
          )}
          <Row
            label="Net income"
            value={data.totals.netIncome}
            sub={`${fmtPct(data.totals.netMargin)} margin`}
            emphasis
          />
        </div>
      </div>

      <Modal
        open={openLine !== null}
        onClose={() => setOpenLine(null)}
        title={openLine ? `Detail · ${openLine.label}` : ""}
        size="lg"
      >
        {pending ? (
          <div className="px-2 py-6 text-center text-xs text-muted">
            Loading…
          </div>
        ) : error ? (
          <div className="text-[11px] text-danger">{error}</div>
        ) : rows && rows.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted">
            No transactions for this account in this period.
          </div>
        ) : rows ? (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-[11px] uppercase text-muted">
                <tr>
                  <th className="px-3 py-1.5 text-left">Date</th>
                  <th className="px-3 py-1.5 text-left">Entity</th>
                  <th className="px-3 py-1.5 text-left">Description</th>
                  <th className="px-3 py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-1 font-mono text-[11px]">
                      {fmtDate(r.acc_date)}
                    </td>
                    <td className="px-3 py-1">{r.entity}</td>
                    <td className="px-3 py-1 text-muted">
                      {r.description ?? r.memo ?? "—"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1 text-right font-mono",
                        r.amount < 0 && "text-danger",
                      )}
                    >
                      {fmt(Number(r.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function Section({
  title,
  lines,
  total,
  totalLabel,
  onClick,
}: {
  title: string;
  lines: PnlLine[];
  total: number;
  totalLabel: string;
  onClick: (line: PnlLine) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </div>
      <div>
        {lines.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted">No activity.</div>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((l) => (
              <li
                key={l.accountId}
                className="flex items-center justify-between px-4 py-1.5 text-xs"
              >
                <button
                  type="button"
                  className="text-left text-info hover:underline"
                  onClick={() => onClick(l)}
                >
                  {l.label}
                </button>
                <span className="font-mono">{fmt(l.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between border-t border-border bg-surface-2 px-4 py-2 text-xs font-semibold">
          <span>{totalLabel}</span>
          <span
            className={cn(
              "font-mono",
              total < 0 ? "text-danger" : "text-foreground",
            )}
          >
            {fmt(total)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: number;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-1.5 text-xs last:border-b-0 last:pb-0">
      <div className="flex flex-col">
        <span className={emphasis ? "font-semibold" : "text-muted"}>
          {label}
        </span>
        {sub ? <span className="text-[10px] text-muted">{sub}</span> : null}
      </div>
      <span
        className={
          emphasis
            ? value < 0
              ? "font-mono text-base font-bold text-danger"
              : "font-mono text-base font-bold text-foreground"
            : value < 0
              ? "font-mono text-danger"
              : "font-mono"
        }
      >
        {fmt(value)}
      </span>
    </div>
  );
}
