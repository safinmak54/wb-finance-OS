"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDate, toCsv } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import { drillDownAccount } from "@/actions/reports";
import { editTransaction } from "@/actions/transactions";
import type { DrillDownTxn } from "@/lib/queries/transactions";

export type PnlRow =
  | { kind: "group"; label: string }
  | {
      kind: "section";
      sectionId: string;
      label: string;
      total: Record<string, number>;
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
    };

export type PnlDocument = {
  view: "annual" | "monthly";
  valueColumns: Array<{ key: string; label: string }>;
  rows: PnlRow[];
  range: { from: string; to: string };
  accounts: Array<{ id: string; code: string; name: string }>;
};

type DrillContext = {
  accountId: string;
  accountLabel: string;
  columnKey: string;
  columnLabel: string;
};

export function PnlClient({ doc }: { doc: PnlDocument }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [drill, setDrill] = useState<DrillContext | null>(null);

  function toggle(id: string) {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  }

  // Layout: A (group) | B (section) | C (account / collapse) | D...D (values)
  const gridCols = `minmax(160px, 1.4fr) minmax(140px, 1.2fr) minmax(180px, 2fr) ${doc.valueColumns
    .map(() => "minmax(100px, 1fr)")
    .join(" ")}`;

  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <ViewToggle current={doc.view} />
        <span className="text-muted">
          {doc.range.from} → {doc.range.to}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <div className="min-w-fit">
          {/* Header */}
          <div
            className="grid items-end gap-x-2 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div>Group</div>
            <div>Section</div>
            <div>Account</div>
            {doc.valueColumns.map((c) => (
              <div key={c.key} className="text-right">
                {c.label}
              </div>
            ))}
          </div>

          {doc.rows.map((row, i) => {
            if (row.kind === "group") {
              return (
                <div
                  key={`g-${i}`}
                  className="grid items-center gap-x-2 border-t border-border bg-surface-2 px-3 py-2 text-[12px] font-semibold uppercase tracking-wider"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div>{row.label}</div>
                </div>
              );
            }

            if (row.kind === "section") {
              const isCollapsed = collapsed[row.sectionId] ?? false;
              return (
                <button
                  key={`s-${row.sectionId}`}
                  type="button"
                  onClick={() => toggle(row.sectionId)}
                  className="grid w-full items-center gap-x-2 border-t border-border px-3 py-1.5 text-left text-xs font-medium hover:bg-surface-2"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div />
                  <div>{row.label}</div>
                  <div className="flex items-center gap-1 text-muted">
                    <span>{isCollapsed ? "▶" : "▼"}</span>
                    <span className="text-[10px] uppercase tracking-wider">
                      {isCollapsed ? "Expand" : "Collapse"}
                    </span>
                  </div>
                  {doc.valueColumns.map((c) => {
                    const v = row.total[c.key] ?? 0;
                    return (
                      <div
                        key={c.key}
                        className={cn(
                          "text-right font-mono text-[12px] font-semibold",
                          v < 0 ? "text-danger" : "text-foreground",
                        )}
                      >
                        {fmt(v)}
                      </div>
                    );
                  })}
                </button>
              );
            }

            if (row.kind === "account") {
              if (collapsed[row.sectionId]) return null;
              return (
                <div
                  key={`a-${row.accountId}`}
                  className="grid items-center gap-x-2 border-t border-border px-3 py-1 text-xs hover:bg-surface-2/40"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div />
                  <div />
                  <div className="text-muted">{row.label}</div>
                  {doc.valueColumns.map((c) => {
                    const v = row.values[c.key] ?? 0;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className={cn(
                          "text-right font-mono hover:underline",
                          v < 0 ? "text-danger" : "text-foreground",
                          v === 0 && "text-muted/60",
                        )}
                        onClick={() =>
                          setDrill({
                            accountId: row.accountId,
                            accountLabel: row.label,
                            columnKey: c.key,
                            columnLabel: c.label,
                          })
                        }
                        disabled={v === 0}
                      >
                        {fmt(v)}
                      </button>
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
                  "grid items-center gap-x-2 border-t border-border px-3 py-2 text-xs font-semibold",
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
                  return (
                    <div
                      key={c.key}
                      className={cn(
                        "text-right font-mono text-[13px]",
                        v < 0 ? "text-danger" : "text-foreground",
                      )}
                    >
                      {fmt(v)}
                    </div>
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

function ViewToggle({ current }: { current: "annual" | "monthly" }) {
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
        href="?view=monthly"
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
    startTransition(async () => {
      try {
        const r = await drillDownAccount({
          accountId: ctx.accountId,
          from: doc.range.from,
          to: doc.range.to,
          entity: "all",
        });
        setRows(r);
      } catch (e) {
        setError((e as Error).message);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.accountId, ctx?.columnKey]);

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
    if (!rows || rows.length === 0) return;
    const accountName = ctx?.accountLabel ?? "transactions";
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
    a.download = `${accountName.replace(/[^a-z0-9]+/gi, "_")}_${doc.range.from}_${doc.range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Modal
      open={ctx !== null}
      onClose={onClose}
      title={ctx ? `${ctx.accountLabel} · ${ctx.columnLabel}` : ""}
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
