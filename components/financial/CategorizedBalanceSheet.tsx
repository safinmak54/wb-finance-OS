"use client";

import { useEffect, useState, useTransition } from "react";
import { fmt, fmtDateShort } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { Modal } from "@/components/ui/Modal";
import { drillDownBalanceAccountSet } from "@/actions/reports";
import { saveOwnerDistribution } from "@/actions/balance";
import type { DrillDownTxn } from "@/lib/queries/transactions";
import type { ExactBalanceSheet, ExactBSRow } from "@/lib/balance/structure";

type DrillCtx = {
  title: string;
  accountIds: string[];
  /** Asset lines display −rawSum, so flip the signed ledger amount to match. */
  flip: boolean;
};

/** Live state for the editable Owner's Distribution line + the equity total it
 *  feeds. Threaded to the right panel only. */
type DistDynamic = {
  magnitude: number;
  canEdit: boolean;
  saving: boolean;
  onCommit: (raw: string) => void;
  equityTotal: number;
};

/**
 * Fixed-template balance sheet — reproduces the exact two-panel layout the
 * COO specified: Assets on the left, Liabilities stacked over Owner's Equity
 * on the right, with the accounting-equation lines beneath. Every category /
 * clearing line is a static row (see `buildExactBalanceSheet`); real balances
 * are plugged in by account code. Clicking any line with a mapped GL account
 * opens a modal listing the transactions that make up that line.
 */
export function CategorizedBalanceSheet({
  sheet,
  codeToId,
  entity,
  ownerDistribution,
  canEditDistribution,
  equityExclDistribution,
}: {
  sheet: ExactBalanceSheet;
  /** account_code → account_id, for resolving a row's codes to a query. */
  codeToId: Record<string, string>;
  entity: string;
  /** Stored Owner's Distribution magnitude (positive; reduces equity). */
  ownerDistribution: number;
  /** Editable only for a single entity — the consolidated view shows the sum. */
  canEditDistribution: boolean;
  /** Equity excluding distribution (Retained Earnings + Net Income). */
  equityExclDistribution: number;
}) {
  const [drill, setDrill] = useState<DrillCtx | null>(null);

  // Owner's Distribution is edited inline; the equity total + accounting-
  // equation footer recompute live from it, then persist on commit.
  const [magnitude, setMagnitude] = useState(ownerDistribution);
  const [savingDist, startSaveDist] = useTransition();
  useEffect(() => setMagnitude(ownerDistribution), [ownerDistribution]);

  function commitDistribution(raw: string) {
    const parsed = Math.abs(Number(raw.replace(/[^0-9.]/g, "")) || 0);
    if (parsed === magnitude) return;
    setMagnitude(parsed);
    startSaveDist(async () => {
      try {
        await saveOwnerDistribution({ entity, value: parsed });
      } catch {
        setMagnitude(ownerDistribution); // revert on failure
      }
    });
  }

  const liveEquityTotal = equityExclDistribution - magnitude;
  const totalLE = sheet.totalLiabilities + liveEquityTotal;
  const balanced = Math.abs(sheet.totalAssets - totalLE) < 0.5;

  const dynamic: DistDynamic = {
    magnitude,
    canEdit: canEditDistribution,
    saving: savingDist,
    onCommit: commitDistribution,
    equityTotal: liveEquityTotal,
  };

  function openDrill(row: ExactBSRow, flip: boolean) {
    if (row.kind === "spacer" || row.kind === "section") return;
    const codes = row.codes ?? [];
    const accountIds = codes
      .map((c) => codeToId[c])
      .filter((id): id is string => Boolean(id));
    if (accountIds.length === 0) return;
    setDrill({ title: row.label, accountIds, flip });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel rows={sheet.assets} flip onDrill={openDrill} codeToId={codeToId} />
        <div className="flex flex-col gap-4">
          <Panel
            rows={sheet.liabilities}
            flip={false}
            onDrill={openDrill}
            codeToId={codeToId}
          />
          <Panel
            rows={sheet.equity}
            flip={false}
            onDrill={openDrill}
            codeToId={codeToId}
            dynamic={dynamic}
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface px-4 py-4 shadow-card">
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-foreground">
            TOTAL ASSET = LIABILITIES + OWNER&apos;S EQUITY
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[11px] text-muted">
          <span>
            Total Assets{" "}
            <span className="font-mono tabular-nums text-foreground">
              {fmt(sheet.totalAssets)}
            </span>
          </span>
          <span>
            Liabilities + Equity{" "}
            <span className="font-mono tabular-nums text-foreground">
              {fmt(totalLE)}
            </span>
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-semibold",
              balanced
                ? "bg-success-soft text-success"
                : "bg-danger-soft text-danger",
            )}
          >
            {balanced
              ? "✓ Balanced"
              : `⚠ Out by ${fmt(sheet.totalAssets - totalLE)}`}
          </span>
        </div>
      </div>

      <DrillModal ctx={drill} entity={entity} onClose={() => setDrill(null)} />
    </div>
  );
}

function Panel({
  rows,
  flip,
  onDrill,
  codeToId,
  dynamic,
}: {
  rows: ExactBSRow[];
  flip: boolean;
  onDrill: (row: ExactBSRow, flip: boolean) => void;
  codeToId: Record<string, string>;
  dynamic?: DistDynamic;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row, i) => (
            <RowView
              key={i}
              row={row}
              flip={flip}
              onDrill={onDrill}
              codeToId={codeToId}
              dynamic={dynamic}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function hasDrill(row: ExactBSRow, codeToId: Record<string, string>): boolean {
  if (row.kind === "spacer" || row.kind === "section") return false;
  return (row.codes ?? []).some((c) => codeToId[c]);
}

function RowView({
  row,
  flip,
  onDrill,
  codeToId,
  dynamic,
}: {
  row: ExactBSRow;
  flip: boolean;
  onDrill: (row: ExactBSRow, flip: boolean) => void;
  codeToId: Record<string, string>;
  dynamic?: DistDynamic;
}) {
  const drillable = hasDrill(row, codeToId);
  const clickProps = drillable
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick: () => onDrill(row, flip),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onDrill(row, flip);
          }
        },
      }
    : {};
  const labelClass = cn(drillable && "cursor-pointer hover:underline");

  switch (row.kind) {
    case "section":
      return (
        <tr>
          <td
            colSpan={2}
            className="border-b border-border bg-surface-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-foreground"
          >
            {row.label}
          </td>
        </tr>
      );
    case "category":
      return (
        <tr className="border-t border-border/60">
          <td className="px-4 py-1.5 font-semibold text-foreground">
            <span {...clickProps} className={labelClass}>
              {row.label}
            </span>
          </td>
          <td className="px-4 py-1.5 text-right">
            {row.amount === null ? null : (
              <span {...clickProps} className={labelClass}>
                <Amount value={flip ? -row.amount : row.amount} />
              </span>
            )}
          </td>
        </tr>
      );
    case "line":
      if (row.role === "ownerDistribution" && dynamic) {
        return (
          <tr>
            <td className="py-1 pl-10 pr-4 text-[11px] text-muted">
              {row.label}
            </td>
            <td className="px-4 py-1 text-right">
              {dynamic.canEdit ? (
                <input
                  key={dynamic.magnitude}
                  type="text"
                  inputMode="decimal"
                  defaultValue={dynamic.magnitude ? String(dynamic.magnitude) : ""}
                  placeholder="0"
                  aria-label="Owner's Distribution"
                  aria-busy={dynamic.saving}
                  onBlur={(e) => dynamic.onCommit(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className={cn(
                    "w-24 rounded border border-border bg-surface px-2 py-0.5 text-right font-mono text-[11px] tabular-nums text-foreground outline-none focus:border-info",
                    dynamic.saving && "animate-pulse opacity-60",
                  )}
                />
              ) : (
                <Amount value={-dynamic.magnitude} muted />
              )}
            </td>
          </tr>
        );
      }
      return (
        <tr>
          <td className="py-1 pl-10 pr-4 text-[11px] text-muted">
            <span {...clickProps} className={labelClass}>
              {row.label}
            </span>
          </td>
          <td className="px-4 py-1 text-right">
            <span {...clickProps} className={labelClass}>
              <Amount value={flip ? -row.amount : row.amount} muted />
            </span>
          </td>
        </tr>
      );
    case "total": {
      const amount =
        row.role === "equityTotal" && dynamic ? dynamic.equityTotal : row.amount;
      return (
        <tr>
          <td className="border-t-2 border-border bg-surface-2 px-4 py-2 text-xs font-bold uppercase tracking-wide text-foreground">
            <span {...clickProps} className={labelClass}>
              {row.label}
            </span>
          </td>
          <td className="border-t-2 border-border bg-surface-2 px-4 py-2 text-right">
            <span {...clickProps} className={labelClass}>
              <Amount
                value={flip ? -amount : amount}
                className="text-sm font-bold"
              />
            </span>
          </td>
        </tr>
      );
    }
    case "spacer":
      return (
        <tr>
          <td colSpan={2} className="py-1.5" />
        </tr>
      );
  }
}

function DrillModal({
  ctx,
  entity,
  onClose,
}: {
  ctx: DrillCtx | null;
  entity: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DrillDownTxn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!ctx) {
      setRows(null);
      setError(null);
      return;
    }
    setRows(null);
    setError(null);
    startTransition(async () => {
      try {
        const data = await drillDownBalanceAccountSet({
          accountIds: ctx.accountIds,
          entity,
        });
        setRows(data);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }, [ctx, entity]);

  const total = (rows ?? []).reduce(
    (s, t) => s + (ctx?.flip ? -Number(t.amount) : Number(t.amount)),
    0,
  );

  return (
    <Modal
      open={Boolean(ctx)}
      onClose={onClose}
      title={ctx ? `${ctx.title} — transactions` : ""}
      size="lg"
    >
      {pending ? (
        <div className="px-1 py-8 text-center text-sm text-muted">Loading…</div>
      ) : error ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          {error}
        </div>
      ) : rows && rows.length === 0 ? (
        <div className="px-1 py-8 text-center text-sm text-muted">
          No transactions make up this line yet.
        </div>
      ) : rows ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Entity</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const value = ctx?.flip ? -Number(t.amount) : Number(t.amount);
                return (
                  <tr key={t.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {fmtDateShort(t.acc_date)}
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-muted">
                      {t.entity}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="block max-w-[360px] truncate">
                        {t.description || (
                          <span className="text-muted">—</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Amount value={value} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-2">
                <td colSpan={3} className="px-3 py-2 text-xs font-semibold">
                  Total · {rows.length} transaction{rows.length === 1 ? "" : "s"}
                </td>
                <td className="px-3 py-2 text-right">
                  <Amount value={total} className="text-sm font-bold" />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </Modal>
  );
}

function Amount({
  value,
  muted,
  className,
}: {
  value: number;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        value < 0 ? "text-danger" : muted ? "text-muted" : "text-foreground",
        className,
      )}
    >
      {fmt(value)}
    </span>
  );
}
