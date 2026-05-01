"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select } from "@/components/ui/Field";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDateShort, today } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import {
  createJournal,
  deleteJournal,
  closeMonth,
} from "@/actions/journals";
import type { Account } from "@/lib/supabase/types";
import type { JournalRow } from "@/lib/queries/journals";

type Props = {
  journals: JournalRow[];
  accounts: Account[];
  entities: Array<{ id: string; code: string }>;
  period: string;
};

export function JournalsClient({ journals, accounts, entities, period }: Props) {
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [, startTransition] = useTransition();

  async function onDelete(id: string) {
    if (!confirm("Delete this journal entry?")) return;
    try {
      await deleteJournal(id);
      toast.push("Journal deleted", "success");
    } catch (err) {
      toast.push((err as Error).message, "error");
    }
  }

  async function onCloseMonth() {
    if (!confirm(`Close ${period}? No further postings allowed.`)) return;
    startTransition(async () => {
      try {
        await closeMonth({ period });
        toast.push("Month closed", "success");
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCloseMonth}>
          Close {period}
        </Button>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          + New journal
        </Button>
      </div>

      {journals.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-xs text-muted">
              No journal entries in this period.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {journals.map((j) => {
            const dr = j.ledger_entries.reduce(
              (s, l) => s + Number(l.debit_amount ?? 0),
              0,
            );
            const cr = j.ledger_entries.reduce(
              (s, l) => s + Number(l.credit_amount ?? 0),
              0,
            );
            return (
              <Card key={j.id}>
                <CardHeader
                  title={j.description}
                  subtitle={`${fmtDateShort(j.accounting_date)} · ${j.entity ?? ""} · ${j.entry_type}`}
                  actions={
                    <>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                          j.status === "POSTED"
                            ? "bg-success-soft text-success"
                            : "bg-warning-soft text-warning",
                        )}
                      >
                        {j.status}
                      </span>
                      <button
                        type="button"
                        className="text-[11px] font-medium text-danger hover:underline"
                        onClick={() => onDelete(j.id)}
                      >
                        Delete
                      </button>
                    </>
                  }
                />
                <CardBody className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-2 text-[11px] uppercase text-muted">
                      <tr>
                        <th className="px-3 py-1.5 text-left">Account</th>
                        <th className="px-3 py-1.5 text-left">Memo</th>
                        <th className="px-3 py-1.5 text-right">Debit</th>
                        <th className="px-3 py-1.5 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {j.ledger_entries.map((l, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-1 font-mono text-[11px]">
                            {l.accounts
                              ? `${l.accounts.account_code} · ${l.accounts.account_name}`
                              : "—"}
                          </td>
                          <td className="px-3 py-1 text-muted">{l.memo ?? ""}</td>
                          <td className="px-3 py-1 text-right font-mono">
                            {l.debit_amount ? fmt(Number(l.debit_amount)) : ""}
                          </td>
                          <td className="px-3 py-1 text-right font-mono">
                            {l.credit_amount ? fmt(Number(l.credit_amount)) : ""}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-border bg-surface-2 text-[11px] font-semibold">
                        <td colSpan={2} className="px-3 py-1.5">
                          Totals
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmt(dr)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmt(cr)}</td>
                      </tr>
                    </tbody>
                  </table>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <NewJournalModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmitted={() => {
          setShowAdd(false);
          toast.push("Journal entry created", "success");
        }}
        accounts={accounts}
        entities={entities}
      />
    </div>
  );
}

type Line = {
  account_id: string;
  debit: string;
  credit: string;
  memo: string;
};

function emptyLine(): Line {
  return { account_id: "", debit: "", credit: "", memo: "" };
}

function NewJournalModal({
  open,
  onClose,
  onSubmitted,
  accounts,
  entities,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  accounts: Account[];
  entities: Array<{ id: string; code: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [entity, setEntity] = useState(entities[0]?.code ?? "");
  const [entryType, setEntryType] = useState<
    "manual" | "accrual" | "elimination" | "distribution"
  >("manual");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  function update(i: number, patch: Partial<Line>) {
    const next = [...lines];
    next[i] = { ...next[i], ...patch };
    setLines(next);
  }

  function add() {
    setLines([...lines, emptyLine()]);
  }

  function remove(i: number) {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, idx) => idx !== i));
  }

  const drTotal = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const crTotal = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(drTotal - crTotal) < 0.01 && drTotal > 0;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!balanced) {
      setError("Journal is unbalanced");
      return;
    }
    startTransition(async () => {
      try {
        await createJournal({
          accounting_date: date,
          description,
          entity,
          entry_type: entryType,
          status: "POSTED",
          is_intercompany: entryType === "elimination",
          lines: lines
            .filter((l) => l.account_id && (l.debit || l.credit))
            .map((l) => ({
              account_id: l.account_id,
              debit_amount: Number(l.debit) || 0,
              credit_amount: Number(l.credit) || 0,
              memo: l.memo || undefined,
            })),
        });
        onSubmitted();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="New journal entry" size="lg">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <TextInput
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Entity">
            <Select required value={entity} onChange={(e) => setEntity(e.target.value)}>
              {entities.map((en) => (
                <option key={en.id} value={en.code}>
                  {en.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select
              value={entryType}
              onChange={(e) => setEntryType(e.target.value as typeof entryType)}
            >
              <option value="manual">Manual</option>
              <option value="accrual">Accrual</option>
              <option value="elimination">Elimination</option>
              <option value="distribution">Distribution</option>
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <TextInput
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-[11px] uppercase text-muted">
              <tr>
                <th className="px-2 py-1.5 text-left">Account</th>
                <th className="px-2 py-1.5 text-left">Memo</th>
                <th className="px-2 py-1.5 text-right">Debit</th>
                <th className="px-2 py-1.5 text-right">Credit</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1">
                    <select
                      required
                      value={l.account_id}
                      onChange={(e) => update(i, { account_id: e.target.value })}
                      className="h-7 w-full rounded-md border border-border bg-surface px-1.5 text-[11px]"
                    >
                      <option value="">—</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.account_code} · {a.account_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={l.memo}
                      onChange={(e) => update(i, { memo: e.target.value })}
                      className="h-7 w-full rounded-md border border-border bg-surface px-1.5 text-[11px]"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.debit}
                      onChange={(e) =>
                        update(i, { debit: e.target.value, credit: "" })
                      }
                      className="h-7 w-full rounded-md border border-border bg-surface px-1.5 text-right font-mono text-[11px]"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.credit}
                      onChange={(e) =>
                        update(i, { credit: e.target.value, debit: "" })
                      }
                      className="h-7 w-full rounded-md border border-border bg-surface px-1.5 text-right font-mono text-[11px]"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      className="text-[11px] text-danger hover:underline"
                      onClick={() => remove(i)}
                      disabled={lines.length <= 2}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border bg-surface-2 text-[11px] font-semibold">
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    className="text-info hover:underline"
                    onClick={add}
                  >
                    + Add line
                  </button>
                </td>
                <td className="px-2 py-1.5 text-right">Totals</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(drTotal)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmt(crTotal)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div
          className={cn(
            "rounded-md px-3 py-2 text-[11px]",
            balanced
              ? "bg-success-soft text-success"
              : "bg-warning-soft text-warning",
          )}
        >
          {balanced
            ? "✓ Balanced"
            : `Unbalanced: debits ${fmt(drTotal)} ≠ credits ${fmt(crTotal)}`}
        </div>

        {error ? <div className="text-[11px] text-danger">{error}</div> : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || !balanced}>
            Post
          </Button>
        </div>
      </form>
    </Modal>
  );
}
