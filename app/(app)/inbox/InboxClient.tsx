"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import {
  classifyTransaction,
  bulkClassifyTransactions,
  splitTransaction,
  deleteRawTransaction,
  markAsInternalTransfer,
  markAsCcPayment,
  editRawTransactionDate,
} from "@/actions/transactions";
import { bulkAutoTag } from "@/actions/classify";
import { EditableDateCell } from "@/components/transactions/EditableDateCell";
import { ImportClient } from "@/app/(app)/import/ImportClient";
import type {
  Account,
  BankConnection,
  RawTransaction,
} from "@/lib/supabase/types";
import type { TxnKind } from "@/lib/classify-rules";

type Row = RawTransaction & {
  entity_code: string | null;
  kind: TxnKind;
  /** Optional payment-method/type bucket (Cashbook inbox only). */
  category?: string;
};

type Props = {
  rows: Row[];
  accounts: Account[];
  entities: Array<{ id: string; code: string }>;
  autoTags?: Record<string, { accountId: string }>;
  sources: string[];
  banks: BankConnection[];
  entityFilter?: string;
  /** When provided, renders a payment-method filter (Cashbook inbox). */
  categories?: string[];
  /** Hide the kind/source/bank filter bar (irrelevant for the Cashbook
   *  inbox, where every row shares one source). Defaults to shown. */
  showSourceFilters?: boolean;
};

type KindFilter = "all" | TxnKind;

export function InboxClient({
  rows,
  accounts,
  entities,
  autoTags,
  sources,
  banks,
  entityFilter,
  categories,
  showSourceFilters = true,
}: Props) {
  const toast = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rowPending, startRowTransition] = useTransition();
  /** Id of the row whose per-row action is currently running, so only its
   *  buttons disable (a shared spinner across every row would feel wrong). */
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [picks, setPicks] = useState<Record<string, { acct?: string; entity?: string }>>(
    () => {
      const initial: Record<string, { acct?: string; entity?: string }> = {};
      if (autoTags) {
        for (const [id, hit] of Object.entries(autoTags)) {
          initial[id] = { acct: hit.accountId };
        }
      }
      return initial;
    },
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splitting, setSplitting] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [bankFilter, setBankFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const autoTagCount = autoTags ? Object.keys(autoTags).length : 0;

  const kindCounts = useMemo(() => {
    const counts: Record<TxnKind, number> = { transfer: 0, cc_payment: 0, other: 0 };
    for (const r of rows) counts[r.kind] += 1;
    return counts;
  }, [rows]);

  const categoryCounts = useMemo(() => {
    if (!categories) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (const c of categories) counts[c] = 0;
    for (const r of rows) {
      if (r.category && r.category in counts) counts[r.category] += 1;
    }
    return counts;
  }, [rows, categories]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (bankFilter !== "all") {
        if (bankFilter === "none") {
          if (r.bank_connection_id) return false;
        } else if (r.bank_connection_id !== bankFilter) return false;
      }
      return true;
    });
  }, [rows, kindFilter, sourceFilter, bankFilter, categoryFilter]);

  function update(id: string, patch: { acct?: string; entity?: string }) {
    setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    const allIds = filteredRows.map((r) => r.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
    if (allSelected) {
      const next = new Set(selected);
      for (const id of allIds) next.delete(id);
      setSelected(next);
    } else {
      setSelected(new Set([...selected, ...allIds]));
    }
  }

  function selectRuleMatched() {
    if (!autoTags) return;
    const ids = filteredRows
      .map((r) => r.id)
      .filter((id) => autoTags[id] && (picks[id]?.acct ?? autoTags[id].accountId));
    setSelected(new Set(ids));
    const missing = filteredRows.filter((r) => autoTags[r.id]).length - ids.length;
    toast.push(
      missing > 0
        ? `Selected ${ids.length} rule-matched · ${missing} missing account`
        : `Selected ${ids.length} rule-matched rows`,
      missing > 0 ? "error" : "info",
    );
  }

  function classifyOne(r: Row) {
    const pick = picks[r.id] ?? {};
    const acct = pick.acct;
    const entity = pick.entity ?? r.entity_code;
    if (!acct) {
      toast.push("Pick an account", "error");
      return;
    }
    if (!entity) {
      toast.push("Pick an entity", "error");
      return;
    }
    setBusyRow(r.id);
    startRowTransition(async () => {
      try {
        await classifyTransaction({
          rawId: r.id,
          accountId: acct,
          entityCode: entity,
        });
        toast.push("Classified", "success");
      } catch (err) {
        toast.push((err as Error).message, "error");
      } finally {
        setBusyRow(null);
      }
    });
  }

  function bulk() {
    if (selected.size === 0) {
      toast.push("No rows selected", "error");
      return;
    }
    const targets: { rawId: string; accountId: string; entityCode: string }[] = [];
    // Rows that are selected but can't be posted yet (no account and/or no
    // entity). We skip these rather than aborting the whole batch, and keep
    // them selected so they can be completed and re-finalized.
    const incomplete = new Set<string>();
    for (const id of selected) {
      const r = rows.find((x) => x.id === id);
      if (!r) continue;
      const pick = picks[id] ?? {};
      const acct = pick.acct;
      const entity = pick.entity ?? r.entity_code;
      if (!acct || !entity) {
        incomplete.add(id);
        continue;
      }
      targets.push({ rawId: r.id, accountId: acct, entityCode: entity });
    }
    if (targets.length === 0) {
      toast.push(
        `Nothing finalized — ${incomplete.size} selected ${
          incomplete.size === 1 ? "row is" : "rows are"
        } missing an account or entity`,
        "error",
      );
      return;
    }
    startTransition(async () => {
      try {
        await bulkClassifyTransactions({ rows: targets });
        toast.push(
          incomplete.size > 0
            ? `Finalized ${targets.length} · skipped ${incomplete.size} missing account/entity`
            : `Classified ${targets.length}`,
          incomplete.size > 0 ? "info" : "success",
        );
        setSelected(incomplete);
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  function autoTagAll() {
    startTransition(async () => {
      try {
        const r = await bulkAutoTag({ entity: entityFilter, source: "bank" });
        toast.push(
          r.tagged > 0
            ? `Auto-tagged ${r.tagged} · skipped ${r.skipped}`
            : `No rules matched · ${r.skipped} skipped`,
          r.tagged > 0 ? "success" : "info",
        );
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  function markSelectedTransfer() {
    if (selected.size === 0) {
      toast.push("No rows selected", "error");
      return;
    }
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await markAsInternalTransfer({ ids });
        toast.push(`Marked ${ids.length} as internal transfer`, "success");
        setSelected(new Set());
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  function markSelectedCcPayment() {
    if (selected.size === 0) {
      toast.push("No rows selected", "error");
      return;
    }
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await markAsCcPayment({ ids });
        toast.push(`Marked ${ids.length} as CC payment`, "success");
        setSelected(new Set());
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  function onDelete(id: string) {
    if (!confirm("Delete this transaction?")) return;
    setBusyRow(id);
    startRowTransition(async () => {
      try {
        await deleteRawTransaction(id);
        toast.push("Deleted", "success");
      } catch (err) {
        toast.push((err as Error).message, "error");
      } finally {
        setBusyRow(null);
      }
    });
  }

  async function saveDate(id: string, accountingDate: string) {
    try {
      await editRawTransactionDate({ id, accountingDate });
      toast.push("Date updated", "success");
    } catch (err) {
      toast.push((err as Error).message, "error");
      throw err; // keep the inline editor open so the user can retry
    }
  }

  return (
    <>
      {/* Top action bar — upload + bulk auto-tag */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm ring-1 ring-primary/30 transition hover:bg-primary-hover hover:shadow focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload CSV/XLSX
        </button>
        <Button size="sm" variant="outline" onClick={autoTagAll} loading={isPending}>
          {isPending ? "Auto-tagging…" : "Auto-tag matching rows"}
        </Button>
        {autoTagCount > 0 ? (
          <Button size="sm" variant="ghost" onClick={selectRuleMatched}>
            Select rule-matched ({autoTagCount})
          </Button>
        ) : null}
      </div>

      {/* Payment-method filter (Cashbook inbox only) */}
      {categories && categories.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
          <span className="text-muted">Payment method:</span>
          <KindChip
            label={`All (${rows.length})`}
            active={categoryFilter === "all"}
            onClick={() => setCategoryFilter("all")}
          />
          {categories.map((c) => (
            <KindChip
              key={c}
              label={`${c} (${categoryCounts[c] ?? 0})`}
              active={categoryFilter === c}
              onClick={() => setCategoryFilter(c)}
            />
          ))}
        </div>
      ) : null}

      {/* Kind + source filters */}
      {showSourceFilters ? (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
        <span className="text-muted">Filter:</span>
        <KindChip label={`All (${rows.length})`} active={kindFilter === "all"} onClick={() => setKindFilter("all")} />
        <KindChip
          label={`Internal Transfer (${kindCounts.transfer})`}
          active={kindFilter === "transfer"}
          onClick={() => setKindFilter("transfer")}
        />
        <KindChip
          label={`CC Payment (${kindCounts.cc_payment})`}
          active={kindFilter === "cc_payment"}
          onClick={() => setKindFilter("cc_payment")}
        />
        <KindChip
          label={`Other (${kindCounts.other})`}
          active={kindFilter === "other"}
          onClick={() => setKindFilter("other")}
        />
        <span className="ml-3 text-muted">Source:</span>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11px]"
        >
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {banks.length > 0 ? (
          <>
            <span className="ml-3 text-muted">Bank account:</span>
            <select
              value={bankFilter}
              onChange={(e) => setBankFilter(e.target.value)}
              className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11px]"
            >
              <option value="all">All accounts</option>
              <option value="none">— untagged —</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.institution}
                  {b.account_number ? ` · ${b.account_number}` : ""}
                  {b.entity ? ` (${b.entity})` : ""}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      ) : null}

      {/* Selection action bar */}
      <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <span className="text-xs text-muted">
          {filteredRows.length} of {rows.length} shown
        </span>
        <span className="ml-auto" />
        {selected.size > 0 ? (
          <>
            <span className="text-[11px] text-muted">{selected.size} selected</span>
            <Button size="sm" variant="outline" onClick={markSelectedTransfer} loading={isPending}>
              Mark as Transfer
            </Button>
            <Button size="sm" variant="outline" onClick={markSelectedCcPayment} loading={isPending}>
              Mark as CC Payment
            </Button>
            <Button size="sm" onClick={bulk} loading={isPending}>
              {isPending ? "Finalizing…" : `Finalize ${selected.size}`}
            </Button>
          </>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-2 py-2">
                <input
                  type="checkbox"
                  checked={
                    filteredRows.length > 0 &&
                    filteredRows.every((r) => selected.has(r.id))
                  }
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-3 py-2 text-left">Entity</th>
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  {rows.length === 0 ? "Inbox empty." : "No rows match the current filter."}
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const pick = picks[r.id] ?? {};
                const signed =
                  r.direction === "DEBIT"
                    ? -Math.abs(Number(r.amount))
                    : Math.abs(Number(r.amount));
                const ruleMatched = Boolean(autoTags?.[r.id]);
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-t border-border align-top",
                      ruleMatched && "bg-info-soft/40",
                    )}
                    data-auto-tagged={ruleMatched ? "1" : undefined}
                  >
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <EditableDateCell
                        date={String(r.accounting_date ?? r.transaction_date)}
                        originalDate={String(r.transaction_date)}
                        onSave={(d) => saveDate(r.id, d)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setDetail(r)}
                        title="View transaction details"
                        className="max-w-[300px] truncate text-left text-info hover:underline focus:outline-none focus:ring-1 focus:ring-info"
                      >
                        {r.description || <span className="text-muted">—</span>}
                      </button>
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-1.5 text-right font-mono",
                        signed < 0 ? "text-danger" : "text-success",
                      )}
                    >
                      {fmt(signed)}
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-muted">{r.source}</td>
                    <td className="px-3 py-1.5">
                      <select
                        value={pick.entity ?? r.entity_code ?? ""}
                        onChange={(e) => update(r.id, { entity: e.target.value })}
                        className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11px]"
                      >
                        <option value="">—</option>
                        {entities.map((e) => (
                          <option key={e.id} value={e.code}>
                            {e.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        value={pick.acct ?? ""}
                        onChange={(e) => update(r.id, { acct: e.target.value })}
                        className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11px]"
                      >
                        <option value="">—</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.account_code} · {a.account_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <button
                        type="button"
                        disabled={rowPending && busyRow === r.id}
                        className={cn(
                          "mr-2 text-[11px] font-medium text-info hover:underline",
                          rowPending && busyRow === r.id && "opacity-50",
                        )}
                        onClick={() => classifyOne(r)}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="mr-2 text-[11px] font-medium text-muted hover:underline"
                        onClick={() => setSplitting(r)}
                      >
                        Split
                      </button>
                      <button
                        type="button"
                        disabled={rowPending && busyRow === r.id}
                        className={cn(
                          "text-[11px] font-medium text-danger hover:underline",
                          rowPending && busyRow === r.id && "opacity-50",
                        )}
                        onClick={() => onDelete(r.id)}
                      >
                        Del
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <DetailModal
        open={detail !== null}
        row={detail}
        banks={banks}
        onClose={() => setDetail(null)}
      />

      <SplitModal
        key={splitting?.id ?? "split-empty"}
        open={splitting !== null}
        row={splitting}
        onClose={() => setSplitting(null)}
        onSubmitted={() => {
          setSplitting(null);
          toast.push("Split", "success");
        }}
      />

      <Modal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="Upload statement"
        size="lg"
      >
        <ImportClient
          banks={banks}
          onComplete={() => {
            setShowUpload(false);
            router.refresh();
          }}
        />
      </Modal>
    </>
  );
}

function KindChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
        active
          ? "border-info bg-info-soft text-info"
          : "border-border bg-surface text-muted hover:border-info/40",
      )}
    >
      {label}
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-t border-border py-2 first:border-t-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="text-xs text-foreground">{children}</dd>
    </div>
  );
}

function DetailModal({
  open,
  row,
  banks,
  onClose,
}: {
  open: boolean;
  row: Row | null;
  banks: BankConnection[];
  onClose: () => void;
}) {
  if (!row) return null;

  const signed =
    row.direction === "DEBIT"
      ? -Math.abs(Number(row.amount))
      : Math.abs(Number(row.amount));
  const bank = banks.find((b) => b.id === row.bank_connection_id);

  return (
    <Modal open={open} onClose={onClose} title="Transaction details" size="md">
      <dl className="flex flex-col">
        <DetailRow label="Description">
          <span className="whitespace-pre-wrap break-words">
            {row.description || "—"}
          </span>
        </DetailRow>
        <DetailRow label="Amount">
          <span className={cn("font-mono", signed < 0 ? "text-danger" : "text-success")}>
            {fmt(signed)}
          </span>
          <span className="ml-2 text-[11px] text-muted">({row.direction})</span>
        </DetailRow>
        <DetailRow label="Accounting date">
          {String(row.accounting_date ?? row.transaction_date)}
        </DetailRow>
        <DetailRow label="Transaction date">{String(row.transaction_date)}</DetailRow>
        <DetailRow label="Source">{row.source}</DetailRow>
        {row.category ? <DetailRow label="Payment method">{row.category}</DetailRow> : null}
        {bank ? (
          <DetailRow label="Bank">
            {bank.institution}
            {bank.account_number ? ` · ${bank.account_number}` : ""}
            {bank.entity ? ` (${bank.entity})` : ""}
          </DetailRow>
        ) : null}
        {row.bank_account ? <DetailRow label="Bank account">{row.bank_account}</DetailRow> : null}
        {row.account_number ? (
          <DetailRow label="Account number">{row.account_number}</DetailRow>
        ) : null}
        <DetailRow label="Entity">{row.entity_code ?? "—"}</DetailRow>
        <DetailRow label="Status">
          {row.classified ? (
            <span className="text-success">Classified</span>
          ) : (
            <span className="text-muted">Unclassified</span>
          )}
          {row.status ? <span className="ml-2 text-[11px] text-muted">{row.status}</span> : null}
        </DetailRow>
        <DetailRow label="Raw ID">
          <span className="font-mono text-[11px] text-muted">{row.id}</span>
        </DetailRow>
      </dl>

      <div className="mt-4 flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

function SplitModal({
  open,
  row,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  row: Row | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const total = row ? Number(row.amount) : 0;
  const [splits, setSplits] = useState<
    Array<{ amount: string; date: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!row) return null;

  function add() {
    setSplits([...splits, { amount: "", date: String(row!.accounting_date ?? row!.transaction_date) }]);
  }

  function update(i: number, patch: { amount?: string; date?: string }) {
    const next = [...splits];
    next[i] = { ...next[i], ...patch };
    setSplits(next);
  }

  function remove(i: number) {
    setSplits(splits.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (splits.length < 2) {
      setError("Add at least 2 splits");
      return;
    }
    const parsed = splits.map((s) => ({
      amount: Number(s.amount),
      accounting_date: s.date,
    }));
    const sum = parsed.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(sum - total) > 0.01) {
      setError(`Splits total ${fmt(sum)} ≠ original ${fmt(total)}`);
      return;
    }
    startTransition(async () => {
      try {
        await splitTransaction({ rawId: row!.id, splits: parsed });
        onSubmitted();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Split transaction" size="lg">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="rounded-md bg-surface-2 p-3 text-xs">
          <div>{row.description}</div>
          <div>Original: <span className="font-mono">{fmt(total)}</span></div>
        </div>

        <div className="flex flex-col gap-2">
          {splits.map((s, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label="Amount" className="flex-1">
                <TextInput
                  type="number"
                  step="0.01"
                  value={s.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                />
              </Field>
              <Field label="Date" className="flex-1">
                <TextInput
                  type="date"
                  value={s.date}
                  onChange={(e) => update(i, { date: e.target.value })}
                />
              </Field>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => remove(i)}
              >
                ×
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={add}>
            + Add split
          </Button>
        </div>

        {error ? <div className="text-[11px] text-danger">{error}</div> : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={isPending}>
            {isPending ? "Splitting…" : "Split"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
