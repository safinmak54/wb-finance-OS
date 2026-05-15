"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDate, toCsv } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { drillDownAccount, drillDownAccountSet } from "@/actions/reports";
import { editTransaction } from "@/actions/transactions";
import type { DrillDownTxn } from "@/lib/queries/transactions";

export type PnlRow =
  | { kind: "group"; label: string }
  | {
      kind: "section";
      sectionId: string;
      label: string;
      total: Record<string, number>;
      accountIds: string[];
    }
  | {
      kind: "account";
      sectionId: string;
      accountId: string;
      label: string;
      values: Record<string, number>;
    }
  | {
      kind: "computed";
      label: string;
      values: Record<string, number>;
      emphasis?: "primary" | "highlight";
      accountIds: string[];
    };

export type PnlValueColumn = {
  key: string;
  label: string;
  entityCodes: string[];
  range: { from: string; to: string };
};

export type PnlDocument = {
  view: "annual" | "monthly";
  valueColumns: PnlValueColumn[];
  denomByCol: Record<string, number>;
  rows: PnlRow[];
  range: { from: string; to: string };
  entityCol: string | null;
  entityColOptions: Array<{ key: string; label: string }>;
  accounts: Array<{ id: string; code: string; name: string }>;
};

type DrillContext = {
  title: string;
  accountIds: string[];
  // For single-account drill, used by the cheaper drillDownAccount path.
  singleAccountId: string | null;
  entityCodes: string[];
  range: { from: string; to: string };
};

export function PnlClient({ doc }: { doc: PnlDocument }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [drill, setDrill] = useState<DrillContext | null>(null);

  function toggle(id: string) {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  }

  // Each value column expands into (amount, %) pair. % is narrow.
  // Layout: A (group) | B (section) | C (account) | for each col: amount, %
  const valueColTemplate = doc.valueColumns
    .map(() => "minmax(80px, 1fr) minmax(38px, 0.45fr)")
    .join(" ");
  const gridCols = `minmax(140px, 1.2fr) minmax(130px, 1.1fr) minmax(170px, 1.8fr) ${valueColTemplate}`;

  function pct(value: number, denom: number): string {
    if (!denom || denom === 0) return "—";
    const p = (value / denom) * 100;
    if (!isFinite(p)) return "—";
    return `${p >= 0 ? "" : "-"}${Math.abs(p).toFixed(0)}%`;
  }

  function openSectionDrill(row: Extract<PnlRow, { kind: "section" }>, col: PnlValueColumn) {
    setDrill({
      title: `${row.label} · ${col.label}`,
      accountIds: row.accountIds,
      singleAccountId: null,
      entityCodes: col.entityCodes,
      range: col.range,
    });
  }

  function openAccountDrill(
    row: Extract<PnlRow, { kind: "account" }>,
    col: PnlValueColumn,
  ) {
    setDrill({
      title: `${row.label} · ${col.label}`,
      accountIds: [row.accountId],
      singleAccountId: row.accountId,
      entityCodes: col.entityCodes,
      range: col.range,
    });
  }

  function openComputedDrill(
    row: Extract<PnlRow, { kind: "computed" }>,
    col: PnlValueColumn,
  ) {
    setDrill({
      title: `${row.label} · ${col.label}`,
      accountIds: row.accountIds,
      singleAccountId: null,
      entityCodes: col.entityCodes,
      range: col.range,
    });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <ViewToggle current={doc.view} entityCol={doc.entityCol} />
        {doc.view === "monthly" && (
          <EntityTabs current={doc.entityCol ?? "ALL"} options={doc.entityColOptions} />
        )}
        <span className="text-muted">
          {doc.range.from} → {doc.range.to}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <div className="min-w-fit">
          {/* Header */}
          <div
            className="grid items-end gap-x-1.5 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div>Group</div>
            <div>Section</div>
            <div>Account</div>
            {doc.valueColumns.map((c) => (
              <Fragment key={c.key}>
                <div className="text-right">{c.label}</div>
                <div
                  className="text-right text-[10px] normal-case tracking-normal text-muted/70"
                  title="% of Gross Revenue (Revenue section)"
                >
                  %
                </div>
              </Fragment>
            ))}
          </div>

          {doc.rows.map((row, i) => {
            if (row.kind === "group") {
              return (
                <div
                  key={`g-${i}`}
                  className="grid items-center gap-x-1.5 border-t border-border bg-surface-2 px-3 py-2 text-[12px] font-semibold uppercase tracking-wider"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div>{row.label}</div>
                </div>
              );
            }

            if (row.kind === "section") {
              const isCollapsed = collapsed[row.sectionId] ?? false;
              return (
                <div
                  key={`s-${row.sectionId}`}
                  className="grid items-center gap-x-1.5 border-t border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div />
                  <div>{row.label}</div>
                  <button
                    type="button"
                    onClick={() => toggle(row.sectionId)}
                    className="flex items-center gap-1 text-left text-muted"
                  >
                    <span>{isCollapsed ? "▶" : "▼"}</span>
                    <span className="text-[10px] uppercase tracking-wider">
                      {isCollapsed ? "Expand" : "Collapse"}
                    </span>
                  </button>
                  {doc.valueColumns.map((c) => {
                    const v = row.total[c.key] ?? 0;
                    const denom = doc.denomByCol[c.key] ?? 0;
                    return (
                      <Fragment key={c.key}>
                        <button
                          type="button"
                          className={cn(
                            "text-right font-mono text-[12px] font-semibold hover:underline disabled:no-underline",
                            v < 0 ? "text-danger" : "text-foreground",
                            v === 0 && "text-muted/60",
                          )}
                          onClick={() => openSectionDrill(row, c)}
                          disabled={v === 0 || row.accountIds.length === 0}
                        >
                          {fmt(v)}
                        </button>
                        <div className="text-right font-mono text-[10px] text-muted">
                          {pct(v, denom)}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              );
            }

            if (row.kind === "account") {
              if (collapsed[row.sectionId]) return null;
              return (
                <div
                  key={`a-${row.accountId}`}
                  className="grid items-center gap-x-1.5 border-t border-border px-3 py-1 text-xs hover:bg-surface-2/40"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div />
                  <div />
                  <div className="text-muted">{row.label}</div>
                  {doc.valueColumns.map((c) => {
                    const v = row.values[c.key] ?? 0;
                    const denom = doc.denomByCol[c.key] ?? 0;
                    return (
                      <Fragment key={c.key}>
                        <button
                          type="button"
                          className={cn(
                            "text-right font-mono hover:underline",
                            v < 0 ? "text-danger" : "text-foreground",
                            v === 0 && "text-muted/60",
                          )}
                          onClick={() => openAccountDrill(row, c)}
                          disabled={v === 0}
                        >
                          {fmt(v)}
                        </button>
                        <div className="text-right font-mono text-[10px] text-muted">
                          {pct(v, denom)}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              );
            }

            // computed
            return (
              <div
                key={`c-${i}-${row.label}`}
                className={cn(
                  "grid items-center gap-x-1.5 border-t border-border px-3 py-2 text-xs font-semibold",
                  row.emphasis === "primary" && "bg-surface-2",
                  row.emphasis === "highlight" && "bg-info-soft/30",
                )}
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className="uppercase tracking-wider">{row.label}</div>
                <div />
                <div />
                {doc.valueColumns.map((c) => {
                  const v = row.values[c.key] ?? 0;
                  const denom = doc.denomByCol[c.key] ?? 0;
                  return (
                    <Fragment key={c.key}>
                      <button
                        type="button"
                        className={cn(
                          "text-right font-mono text-[13px] hover:underline disabled:no-underline",
                          v < 0 ? "text-danger" : "text-foreground",
                          v === 0 && "text-muted/60",
                        )}
                        onClick={() => openComputedDrill(row, c)}
                        disabled={v === 0 || row.accountIds.length === 0}
                      >
                        {fmt(v)}
                      </button>
                      <div className="text-right font-mono text-[10px] text-muted">
                        {pct(v, denom)}
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <DrillModal ctx={drill} doc={doc} onClose={() => setDrill(null)} />
    </>
  );
}

function ViewToggle({
  current,
  entityCol,
}: {
  current: "annual" | "monthly";
  entityCol: string | null;
}) {
  // Preserve entityCol when switching to monthly so re-toggling feels stable.
  const monthlyHref = `?view=monthly${entityCol ? `&entityCol=${entityCol}` : ""}`;
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-[11px]">
      <Link
        href="?view=annual"
        className={cn(
          "px-2 py-1",
          current === "annual" ? "bg-info-soft text-info" : "text-muted hover:bg-surface-2",
        )}
      >
        Annual
      </Link>
      <Link
        href={monthlyHref}
        className={cn(
          "border-l border-border px-2 py-1",
          current === "monthly" ? "bg-info-soft text-info" : "text-muted hover:bg-surface-2",
        )}
      >
        Monthly
      </Link>
    </div>
  );
}

function EntityTabs({
  current,
  options,
}: {
  current: string;
  options: Array<{ key: string; label: string }>;
}) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-border text-[11px]">
      {options.map((o, i) => (
        <Link
          key={o.key}
          href={`?view=monthly&entityCol=${o.key}`}
          className={cn(
            "px-2 py-1",
            i > 0 && "border-l border-border",
            current === o.key
              ? "bg-info-soft text-info"
              : "text-muted hover:bg-surface-2",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function DrillModal({
  ctx,
  doc,
  onClose,
}: {
  ctx: DrillContext | null;
  doc: PnlDocument;
  onClose: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<DrillDownTxn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { account_id?: string; description?: string }>>(
    {},
  );

  useEffect(() => {
    if (!ctx) {
      setRows(null);
      setError(null);
      setEdits({});
      return;
    }
    setRows(null);
    setError(null);
    setEdits({});
    const snapshot = ctx;
    startTransition(async () => {
      try {
        let r: DrillDownTxn[];
        if (snapshot.singleAccountId) {
          // Single account → use the entity-filter-value path. The column's
          // entityCodes is always a single code (WB, WBP, …) or all 9 codes
          // for ALL; passing "all" when length>1 is equivalent here because
          // the page already pulls all entities.
          const entityArg =
            snapshot.entityCodes.length === 1 ? snapshot.entityCodes[0] : "all";
          r = await drillDownAccount({
            accountId: snapshot.singleAccountId,
            from: snapshot.range.from,
            to: snapshot.range.to,
            entity: entityArg,
          });
        } else {
          r = await drillDownAccountSet({
            accountIds: snapshot.accountIds,
            from: snapshot.range.from,
            to: snapshot.range.to,
            entityCodes: snapshot.entityCodes,
          });
        }
        setRows(r);
      } catch (e) {
        setError((e as Error).message);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.title, ctx?.range.from, ctx?.range.to]);

  function setEdit(id: string, patch: { account_id?: string; description?: string }) {
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  }

  async function save(txnId: string) {
    const e = edits[txnId];
    if (!e || (e.account_id === undefined && e.description === undefined)) {
      toast.push("Nothing to save", "info");
      return;
    }
    setSavingId(txnId);
    try {
      await editTransaction({ id: txnId, ...e });
      toast.push("Saved", "success");
      setRows((prev) =>
        prev
          ? prev.map((r) =>
              r.id === txnId
                ? {
                    ...r,
                    account_id: e.account_id ?? r.account_id,
                    description: e.description ?? r.description,
                  }
                : r,
            )
          : prev,
      );
      setEdits((prev) => {
        const next = { ...prev };
        delete next[txnId];
        return next;
      });
    } catch (err) {
      toast.push((err as Error).message, "error");
    } finally {
      setSavingId(null);
    }
  }

  function downloadCsv() {
    if (!rows || rows.length === 0 || !ctx) return;
    const accountName = ctx.title;
    const csv = toCsv(
      rows.map((r) => ({
        date: r.acc_date,
        entity: r.entity,
        description: r.description ?? "",
        memo: r.memo ?? "",
        amount: Number(r.amount).toFixed(2),
      })),
      [
        { key: "date", label: "Date" },
        { key: "entity", label: "Entity" },
        { key: "description", label: "Description" },
        { key: "memo", label: "Memo" },
        { key: "amount", label: "Amount" },
      ],
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${accountName.replace(/[^a-z0-9]+/gi, "_")}_${ctx.range.from}_${ctx.range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Modal
      open={ctx !== null}
      onClose={onClose}
      title={ctx ? ctx.title : ""}
      size="lg"
    >
      <div className="mb-2 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={downloadCsv}
          disabled={!rows || rows.length === 0}
        >
          Download CSV
        </Button>
      </div>
      {pending && !rows ? (
        <div className="px-2 py-6 text-center text-xs text-muted">Loading…</div>
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
                <th className="px-3 py-1.5 text-left">Account</th>
                <th className="px-3 py-1.5 text-right">Amount</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const edit = edits[r.id] ?? {};
                const hasChanges =
                  edit.account_id !== undefined || edit.description !== undefined;
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-1 font-mono text-[11px]">
                      {fmtDate(r.acc_date)}
                    </td>
                    <td className="px-3 py-1">{r.entity}</td>
                    <td className="px-3 py-1">
                      <input
                        type="text"
                        value={edit.description ?? r.description ?? ""}
                        onChange={(e) => setEdit(r.id, { description: e.target.value })}
                        className="w-full rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px]"
                      />
                    </td>
                    <td className="px-3 py-1">
                      <select
                        value={edit.account_id ?? r.account_id ?? ""}
                        onChange={(e) => setEdit(r.id, { account_id: e.target.value })}
                        className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px]"
                      >
                        {doc.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1 text-right font-mono",
                        r.amount < 0 && "text-danger",
                      )}
                    >
                      {fmt(Number(r.amount))}
                    </td>
                    <td className="px-3 py-1 text-right">
                      <button
                        type="button"
                        disabled={!hasChanges || savingId === r.id}
                        onClick={() => save(r.id)}
                        className={cn(
                          "text-[11px] font-medium",
                          hasChanges ? "text-info hover:underline" : "text-muted/60",
                        )}
                      >
                        {savingId === r.id ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  );
}
