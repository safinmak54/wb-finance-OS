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
} from "@/actions/journals";
import { closeMonthWithAdjustments } from "@/actions/period-close";
import type { Account } from "@/lib/supabase/types";
import type { JournalRow } from "@/lib/queries/journals";

type CashBasis = {
  cashRevenue: number;
  cashCogs: number;
  cashExpenses: number;
};

type Props = {
  journals: JournalRow[];
  accounts: Account[];
  entities: Array<{ id: string; code: string }>;
  period: string;
  entity: string;
  cashBasis: CashBasis;
};

export function JournalsClient({
  journals,
  accounts,
  entities,
  period,
  entity,
  cashBasis,
}: Props) {
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function onDelete(id: string) {
    if (!confirm("Delete this journal entry?")) return;
    setDeletingId(id);
    startDelete(async () => {
      try {
        await deleteJournal(id);
        toast.push("Journal deleted", "success");
      } catch (err) {
        toast.push((err as Error).message, "error");
      } finally {
        setDeletingId(null);
      }
    });
  }

  function onCloseMonth() {
    if (entity === "all") {
      toast.push("Pick a single entity before closing the month", "error");
      return;
    }
    setShowClose(true);
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
                        className="text-[11px] font-medium text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onDelete(j.id)}
                        disabled={isDeleting && deletingId === j.id}
                      >
                        {isDeleting && deletingId === j.id ? "Deleting…" : "Delete"}
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

      <CloseMonthModal
        open={showClose}
        period={period}
        entity={entity}
        cashBasis={cashBasis}
        onClose={() => setShowClose(false)}
        onClosed={(msg) => {
          setShowClose(false);
          toast.push(msg, "success");
        }}
      />
    </div>
  );
}

function CloseMonthModal({
  open,
  period,
  entity,
  cashBasis,
  onClose,
  onClosed,
}: {
  open: boolean;
  period: string;
  entity: string;
  cashBasis: CashBasis;
  onClose: () => void;
  onClosed: (msg: string) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [accrualRevenue, setAccrualRevenue] = useState(
    cashBasis.cashRevenue.toFixed(2),
  );
  const [accrualCogs, setAccrualCogs] = useState(cashBasis.cashCogs.toFixed(2));
  const [memo, setMemo] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const accrualRev = Number(accrualRevenue) || 0;
  const accrualCog = Number(accrualCogs) || 0;
  const revenueAdj = accrualRev - cashBasis.cashRevenue;
  const cogsAdj = accrualCog - cashBasis.cashCogs;
  const netAdj = revenueAdj - cogsAdj;
  const cashNet =
    cashBasis.cashRevenue - cashBasis.cashCogs - cashBasis.cashExpenses;
  const accrualNet = cashNet + netAdj;

  function reset() {
    setStep(1);
    setAccrualRevenue(cashBasis.cashRevenue.toFixed(2));
    setAccrualCogs(cashBasis.cashCogs.toFixed(2));
    setMemo("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await closeMonthWithAdjustments({
          period,
          entity,
          cashRevenue: cashBasis.cashRevenue,
          cashCogs: cashBasis.cashCogs,
          accrualRevenue: accrualRev,
          accrualCogs: accrualCog,
          memo: memo || undefined,
        });
        const tail = res.posted ? "with adjusting entry" : "(no adjustments)";
        onClosed(`${period} closed ${tail}`);
        reset();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Close month: ${period} · ${entity}`}
      size="md"
    >
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Step 1 of 3 — Cash basis summary. These are the totals already
            posted to {entity} for {period}.
          </p>
          <div className="rounded-md border border-border">
            <table className="w-full text-xs">
              <tbody>
                <Row label="Cash revenue" value={cashBasis.cashRevenue} />
                <Row label="Cash COGS" value={-cashBasis.cashCogs} />
                <Row label="Cash expenses" value={-cashBasis.cashExpenses} />
                <Row label="Cash net income" value={cashNet} bold />
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setStep(2)}>
              Next: accruals →
            </Button>
          </div>
        </div>
      ) : step === 2 ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Step 2 of 3 — Accrual amounts. Enter what was earned/owed for the
            period, not just what was paid.
          </p>
          <Field label={`Accrual revenue (cash: ${fmt(cashBasis.cashRevenue)})`}>
            <TextInput
              type="number"
              step="0.01"
              value={accrualRevenue}
              onChange={(e) => setAccrualRevenue(e.target.value)}
            />
          </Field>
          <Field label={`Accrual COGS (cash: ${fmt(cashBasis.cashCogs)})`}>
            <TextInput
              type="number"
              step="0.01"
              value={accrualCogs}
              onChange={(e) => setAccrualCogs(e.target.value)}
            />
          </Field>
          <Field label="Memo (optional)">
            <TextInput
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder={`Adjusting entry — ${period}`}
            />
          </Field>
          <div className="flex justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep(1)}>
              ← Back
            </Button>
            <Button size="sm" onClick={() => setStep(3)}>
              Next: review →
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Step 3 of 3 — Review. Confirming will post an adjusting journal
            entry (if needed) and lock {period} for {entity}.
          </p>
          <div className="rounded-md border border-border">
            <table className="w-full text-xs">
              <tbody>
                <Row label="Revenue adjustment" value={revenueAdj} />
                <Row label="COGS adjustment" value={-cogsAdj} />
                <Row label="Net adjusting entry" value={netAdj} bold />
              </tbody>
            </table>
          </div>
          <div className="rounded-md bg-surface-2 p-3 text-xs">
            <table className="w-full">
              <tbody>
                <Row label="Cash net income" value={cashNet} muted />
                <Row label="Adjusting entry" value={netAdj} muted />
                <Row label="Accrual net income" value={accrualNet} bold />
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-warning">
            ⚠ This will lock {period} for {entity}. No further classifications
            will be allowed in this period.
          </p>
          {error ? (
            <div className="text-[11px] text-danger">{error}</div>
          ) : null}
          <div className="flex justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep(2)}
              disabled={pending}
            >
              ← Back
            </Button>
            <Button size="sm" onClick={confirm} disabled={pending}>
              {pending ? "Closing…" : "Confirm & close"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <tr className={cn(bold && "font-semibold")}>
      <td className={cn("px-3 py-1", muted && "text-muted")}>{label}</td>
      <td
        className={cn(
          "px-3 py-1 text-right font-mono",
          value < 0 ? "text-danger" : value > 0 ? "text-success" : "",
        )}
      >
        {value < 0 ? `(${fmt(Math.abs(value))})` : fmt(value)}
      </td>
    </tr>
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
          <Button type="submit" size="sm" loading={pending} disabled={!balanced}>
            {pending ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
