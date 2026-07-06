"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDate, toCsv } from "@/lib/format";
import { PercentToggle, usePercentDisplay } from "@/components/ui/PercentDisplay";
import { cn } from "@/lib/utils/cn";
import { useRouter } from "next/navigation";
import { drillDownAccount, drillDownAccountSet } from "@/actions/reports";
import { editTransaction } from "@/actions/transactions";
import { upsertPnlManualEntry, deletePnlManualEntry } from "@/actions/pnl-manual";
import { refreshCashbookSnapshot } from "@/actions/cashbook";
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
      accountCode: string;
      manualEditable: boolean;
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
  view: "annual" | "monthly" | "month";
  ytd: { from: string; to: string };
  valueColumns: PnlValueColumn[];
  denomByCol: Record<string, number>;
  rows: PnlRow[];
  range: { from: string; to: string };
  entityCol: string | null;
  entityColOptions: Array<{ key: string; label: string }>;
  selectedMonth: string | null;
  monthOptions: Array<{ key: string; label: string }>;
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

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export function PnlClient({ doc }: { doc: PnlDocument }) {
  const router = useRouter();
  const toast = useToast();
  const { showPct } = usePercentDisplay();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [drill, setDrill] = useState<DrillContext | null>(null);
  const [syncing, startSync] = useTransition();

  // All collapsible section ids, in render order — used by the
  // Simplified/Detailed toggle to collapse or expand every section at once.
  const sectionIds = useMemo(
    () => doc.rows.flatMap((r) => (r.kind === "section" ? [r.sectionId] : [])),
    [doc.rows],
  );

  function toggle(id: string) {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  }

  // Simplified collapses every section (totals only); Detailed expands all.
  function setDetailLevel(level: "simplified" | "detailed") {
    if (level === "simplified") {
      setCollapsed(Object.fromEntries(sectionIds.map((id) => [id, true])));
    } else {
      setCollapsed({});
    }
  }

  // Same Admin API refresh the Cashbook page runs, but scoped to year-to-date
  // (Jan 1 → today). Synthesizes transactions for the whole year so the P&L
  // reflects live Admin API figures without leaving this page.
  function syncYtd() {
    startSync(async () => {
      try {
        const r = await refreshCashbookSnapshot({
          startDate: doc.ytd.from,
          endDate: doc.ytd.to,
        });
        if (r.changedSources.length === 0) {
          toast.push(
            `YTD already up to date — no changes since last sync (${doc.ytd.from} → ${doc.ytd.to})`,
            "info",
          );
        } else {
          toast.push(
            `P&L synced from Admin API · YTD (${doc.ytd.from} → ${doc.ytd.to}) · ${r.changedSources.join(", ")} updated`,
            "success",
          );
        }
        router.refresh();
      } catch (e) {
        toast.push(
          (e as Error).message || "Failed to sync YTD from Admin API",
          "error",
        );
      }
    });
  }

  // Each value column expands into (amount, %) pair. % is narrow, and is
  // dropped entirely when the $/% toggle is set to dollars-only.
  // Single label column (Group/Section/Account share it via indentation) |
  // for each value col: amount[, %].
  const valueColTemplate = doc.valueColumns
    .map(() =>
      showPct ? "minmax(80px, 1fr) minmax(38px, 0.45fr)" : "minmax(80px, 1fr)",
    )
    .join(" ");
  const gridCols = `minmax(220px, 1.6fr) ${valueColTemplate}`;

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
      <div className="mb-3 space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle
            current={doc.view}
            entityCol={doc.entityCol}
            selectedMonth={doc.selectedMonth}
          />
          <DetailToggle
            simplified={
              sectionIds.length > 0 && sectionIds.every((id) => collapsed[id])
            }
            onChange={setDetailLevel}
          />
          <PercentToggle />
          {doc.view === "monthly" && (
            <EntityTabs current={doc.entityCol ?? "ALL"} options={doc.entityColOptions} />
          )}
          <span className="text-muted">
            {doc.range.from} → {doc.range.to}
          </span>
          <div className="ml-auto">
            <Button
              size="sm"
              onClick={syncYtd}
              disabled={syncing}
              title={`Refresh Admin API data for year-to-date (${doc.ytd.from} → ${doc.ytd.to})`}
            >
              {syncing ? "Syncing…" : "Sync YTD from Admin API"}
            </Button>
          </div>
        </div>
        {doc.view === "month" && (
          <InlineMonthFilter
            selected={doc.selectedMonth ?? doc.monthOptions[0]?.key ?? ""}
            options={doc.monthOptions}
          />
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <div className="min-w-fit">
          {/* Header */}
          <div
            className="grid items-end gap-x-1.5 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div>Account</div>
            {doc.valueColumns.map((c) => (
              <Fragment key={c.key}>
                <div className="text-right">{c.label}</div>
                {showPct && (
                  <div
                    className="text-right text-[10px] normal-case tracking-normal text-muted/70"
                    title="% of Gross Revenue (Revenue section)"
                  >
                    %
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          {doc.rows.map((row, i) => {
            if (row.kind === "group") {
              return (
                <div
                  key={`g-${i}`}
                  className="grid items-center gap-x-1.5 border-t border-border bg-surface-2 px-3 py-0.5 text-[12px] font-semibold uppercase tracking-wider"
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
                  className="grid items-center gap-x-1.5 border-t border-border px-3 py-0.5 text-xs font-medium hover:bg-surface-2"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <button
                    type="button"
                    onClick={() => toggle(row.sectionId)}
                    className="flex items-center gap-1 pl-2 text-left"
                    title={isCollapsed ? "Expand" : "Collapse"}
                  >
                    <span className="text-[9px] text-muted">
                      {isCollapsed ? "▶" : "▼"}
                    </span>
                    <span>{row.label}</span>
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
                        {showPct && (
                          <div className="text-right font-mono text-[10px] text-muted">
                            {pct(v, denom)}
                          </div>
                        )}
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
                  className="grid items-center gap-x-1.5 border-t border-border px-3 py-0.5 text-xs hover:bg-surface-2/40"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <div
                    className={cn(
                      "pl-6 text-muted",
                      row.manualEditable && "italic",
                    )}
                    title={
                      row.manualEditable
                        ? "Manual entry — click a monthly cell to edit"
                        : "Sourced from Admin API"
                    }
                  >
                    {row.label}
                  </div>
                  {doc.valueColumns.map((c) => {
                    const v = row.values[c.key] ?? 0;
                    const denom = doc.denomByCol[c.key] ?? 0;
                    const isMonthCol = MONTH_KEY_RE.test(c.key);
                    const editable =
                      row.manualEditable &&
                      isMonthCol &&
                      doc.entityCol !== null;
                    return (
                      <Fragment key={c.key}>
                        {editable ? (
                          <EditableValueCell
                            value={v}
                            accountId={row.accountId}
                            entityCode={doc.entityCol as string}
                            month={c.key}
                            onSaved={() => router.refresh()}
                          />
                        ) : (
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
                        )}
                        {showPct && (
                          <div className="text-right font-mono text-[10px] text-muted">
                            {pct(v, denom)}
                          </div>
                        )}
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
                  "grid items-center gap-x-1.5 border-t border-border px-3 py-0.5 text-xs font-semibold",
                  row.emphasis === "primary" && "bg-surface-2",
                  row.emphasis === "highlight" && "bg-info-soft/30",
                )}
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className="uppercase tracking-wider">{row.label}</div>
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
                      {showPct && (
                        <div className="text-right font-mono text-[10px] text-muted">
                          {pct(v, denom)}
                        </div>
                      )}
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
  selectedMonth,
}: {
  current: "annual" | "monthly" | "month";
  entityCol: string | null;
  selectedMonth: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Preserve entityCol when switching to monthly so re-toggling feels stable.
  const monthlyHref = `?view=monthly${entityCol ? `&entityCol=${entityCol}` : ""}`;
  // Preserve the selected month when switching to per-month.
  const monthHref = `?view=month${selectedMonth ? `&month=${selectedMonth}` : ""}`;
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-[11px]">
      <button
        type="button"
        disabled={isPending}
        aria-disabled={isPending}
        onClick={() => startTransition(() => router.push("?view=annual"))}
        className={cn(
          "px-2 py-1",
          current === "annual" ? "bg-info-soft text-info" : "text-muted hover:bg-surface-2",
          isPending && "opacity-50",
        )}
      >
        Annual
      </button>
      <button
        type="button"
        disabled={isPending}
        aria-disabled={isPending}
        onClick={() => startTransition(() => router.push(monthlyHref))}
        className={cn(
          "border-l border-border px-2 py-1",
          current === "monthly" ? "bg-info-soft text-info" : "text-muted hover:bg-surface-2",
          isPending && "opacity-50",
        )}
      >
        Monthly
      </button>
      <button
        type="button"
        disabled={isPending}
        aria-disabled={isPending}
        onClick={() => startTransition(() => router.push(monthHref))}
        className={cn(
          "border-l border-border px-2 py-1",
          current === "month"
            ? "bg-info-soft text-info"
            : "text-muted hover:bg-surface-2",
          isPending && "opacity-50",
        )}
      >
        Per Month
      </button>
    </div>
  );
}

function DetailToggle({
  simplified,
  onChange,
}: {
  simplified: boolean;
  onChange: (level: "simplified" | "detailed") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border text-[11px]">
      <button
        type="button"
        onClick={() => onChange("simplified")}
        title="Collapse all sections — show section totals only"
        className={cn(
          "px-2 py-1",
          simplified ? "bg-info-soft text-info" : "text-muted hover:bg-surface-2",
        )}
      >
        Simplified
      </button>
      <button
        type="button"
        onClick={() => onChange("detailed")}
        title="Expand all sections — show every account"
        className={cn(
          "border-l border-border px-2 py-1",
          !simplified ? "bg-info-soft text-info" : "text-muted hover:bg-surface-2",
        )}
      >
        Detailed
      </button>
    </div>
  );
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Month filter for the "Per Month" view: a year selector (dropdown) paired
 * with a row of month chips (Jan–Dec) scoped to the chosen year. Months
 * without data (outside the available range) are disabled. `options` is the
 * flat list of selectable YYYY-MM keys most recent first.
 */
function InlineMonthFilter({
  selected,
  options,
}: {
  selected: string;
  options: Array<{ key: string; label: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const validKeys = useMemo(
    () => new Set(options.map((o) => o.key)),
    [options],
  );
  // Distinct years present in the options, newest first.
  const years = useMemo(
    () =>
      Array.from(new Set(options.map((o) => o.key.slice(0, 4)))).sort((a, b) =>
        b.localeCompare(a),
      ),
    [options],
  );

  const selectedYear = selected.slice(0, 4);

  function go(monthKey: string) {
    startTransition(() => router.push(`?view=month&month=${monthKey}`));
  }

  function selectYear(year: string) {
    // Keep the same month-of-year if it exists for the new year; otherwise
    // fall back to the most recent available month in that year.
    const sameMonth = `${year}-${selected.slice(5, 7)}`;
    if (validKeys.has(sameMonth)) {
      go(sameMonth);
      return;
    }
    const latest = options.find((o) => o.key.slice(0, 4) === year);
    if (latest) go(latest.key);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Select month">
      <select
        value={selectedYear}
        disabled={isPending}
        onChange={(e) => selectYear(e.target.value)}
        aria-label="Select year"
        className={cn(
          "shrink-0 rounded-md border border-border bg-surface px-2 py-1 font-medium",
          isPending && "opacity-50",
        )}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {MONTH_LABELS.map((label, i) => {
          const key = `${selectedYear}-${String(i + 1).padStart(2, "0")}`;
          const available = validKeys.has(key);
          const active = key === selected;
          return (
            <button
              key={key}
              type="button"
              disabled={isPending || !available}
              aria-pressed={active}
              onClick={() => go(key)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md border px-2 py-1",
                active
                  ? "border-info bg-info-soft font-medium text-info"
                  : "border-border text-muted hover:bg-surface-2",
                !available && "cursor-not-allowed opacity-30 hover:bg-transparent",
                isPending && "opacity-50",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-border text-[11px]">
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          disabled={isPending}
          aria-disabled={isPending}
          onClick={() =>
            startTransition(() =>
              router.push(`?view=monthly&entityCol=${o.key}`),
            )
          }
          className={cn(
            "px-2 py-1",
            i > 0 && "border-l border-border",
            current === o.key
              ? "bg-info-soft text-info"
              : "text-muted hover:bg-surface-2",
            isPending && "opacity-50",
          )}
        >
          {o.label}
        </button>
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
        // Drill from `transactions_pnl` (latest snapshot only). Use the
        // single-account path when possible; it has a slimmer query plan.
        const r = snapshot.singleAccountId
          ? await drillDownAccount({
              accountId: snapshot.singleAccountId,
              from: snapshot.range.from,
              to: snapshot.range.to,
              entity:
                snapshot.entityCodes.length === 1
                  ? snapshot.entityCodes[0]
                  : undefined,
            })
          : await drillDownAccountSet({
              accountIds: snapshot.accountIds,
              from: snapshot.range.from,
              to: snapshot.range.to,
              entityCodes: snapshot.entityCodes,
            });
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
                        onChange={(e) =>
                          setEdit(r.id, { description: e.target.value })
                        }
                        className="w-full rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px]"
                      />
                    </td>
                    <td className="px-3 py-1">
                      <select
                        value={edit.account_id ?? r.account_id ?? ""}
                        onChange={(e) =>
                          setEdit(r.id, { account_id: e.target.value })
                        }
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
                          hasChanges
                            ? "text-info hover:underline"
                            : "text-muted/60",
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

/**
 * Inline-editable monthly cell for manual P&L accounts. Click → enter input
 * mode → save persists via upsertPnlManualEntry. Save 0 (or blank) clears
 * the override by calling deletePnlManualEntry instead.
 */
function EditableValueCell({
  value,
  accountId,
  entityCode,
  month,
  onSaved,
}: {
  value: number;
  accountId: string;
  entityCode: string;
  month: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(value === 0 ? "" : String(Math.abs(value)));
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft("");
  }

  async function save() {
    const trimmed = draft.trim();
    const amount = trimmed === "" ? 0 : Number(trimmed);
    if (!Number.isFinite(amount)) {
      toast.push("Enter a valid number", "error");
      return;
    }
    setSaving(true);
    try {
      if (amount === 0) {
        await deletePnlManualEntry({ accountId, entityCode, month });
      } else {
        await upsertPnlManualEntry({
          accountId,
          entityCode,
          month,
          amount,
        });
      }
      setEditing(false);
      onSaved();
      toast.push("Saved", "success");
    } catch (e) {
      toast.push((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        className={cn(
          "rounded text-right font-mono hover:bg-info-soft/40 hover:underline",
          value < 0 ? "text-danger" : "text-foreground",
          value === 0 && "text-muted/60",
        )}
        title="Click to edit (manual entry)"
      >
        {fmt(value)}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        step="0.01"
        value={draft}
        autoFocus
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") cancel();
        }}
        className="w-20 rounded border border-border bg-surface px-1 py-0.5 text-right font-mono text-[11px]"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="text-[10px] font-semibold text-info hover:underline disabled:opacity-50"
      >
        {saving ? "…" : "✓"}
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={saving}
        className="text-[10px] text-muted hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}
