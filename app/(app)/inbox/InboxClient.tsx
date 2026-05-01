"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDateShort } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import {
  classifyTransaction,
  bulkClassifyTransactions,
  splitTransaction,
  deleteRawTransaction,
} from "@/actions/transactions";
import type { Account, RawTransaction } from "@/lib/supabase/types";

type Row = RawTransaction & { entity_code: string | null };

type Props = {
  rows: Row[];
  accounts: Account[];
  entities: Array<{ id: string; code: string }>;
};

export function InboxClient({ rows, accounts, entities }: Props) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [picks, setPicks] = useState<Record<string, { acct?: string; entity?: string }>>(
    {},
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splitting, setSplitting] = useState<Row | null>(null);

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
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
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
    startTransition(async () => {
      try {
        await classifyTransaction({
          rawId: r.id,
          accountId: acct,
          entityCode: entity,
        });
        toast.push("Classified", "success");
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  function bulk() {
    const targets: { rawId: string; accountId: string; entityCode: string }[] = [];
    for (const id of selected) {
      const r = rows.find((x) => x.id === id);
      if (!r) continue;
      const pick = picks[id] ?? {};
      const acct = pick.acct;
      const entity = pick.entity ?? r.entity_code;
      if (!acct || !entity) {
        toast.push(`Row ${r.description ?? r.id} missing account/entity`, "error");
        return;
      }
      targets.push({ rawId: r.id, accountId: acct, entityCode: entity });
    }
    if (targets.length === 0) {
      toast.push("No rows selected", "error");
      return;
    }
    startTransition(async () => {
      try {
        await bulkClassifyTransactions({ rows: targets });
        toast.push(`Classified ${targets.length}`, "success");
        setSelected(new Set());
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this transaction?")) return;
    try {
      await deleteRawTransaction(id);
      toast.push("Deleted", "success");
    } catch (err) {
      toast.push((err as Error).message, "error");
    }
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <span className="text-xs text-muted">{rows.length} unclassified</span>
        <span className="ml-auto" />
        {selected.size > 0 ? (
          <>
            <span className="text-[11px] text-muted">{selected.size} selected</span>
            <Button size="sm" onClick={bulk}>
              Finalize {selected.size}
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
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-left">Vendor</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Entity</th>
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  Inbox empty.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const pick = picks[r.id] ?? {};
                const signed =
                  r.direction === "DEBIT"
                    ? -Math.abs(Number(r.amount))
                    : Math.abs(Number(r.amount));
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">
                      {fmtDateShort(String(r.accounting_date ?? r.transaction_date))}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="max-w-[300px] truncate">{r.description}</div>
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-muted">{r.vendor}</td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-1.5 text-right font-mono",
                        signed < 0 ? "text-danger" : "text-success",
                      )}
                    >
                      {fmt(signed)}
                    </td>
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
                        className="mr-2 text-[11px] font-medium text-info hover:underline"
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
                        className="text-[11px] font-medium text-danger hover:underline"
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
    </>
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
    try {
      await splitTransaction({ rawId: row!.id, splits: parsed });
      onSubmitted();
    } catch (err) {
      setError((err as Error).message);
    }
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
          <Button type="submit" size="sm">
            Split
          </Button>
        </div>
      </form>
    </Modal>
  );
}
