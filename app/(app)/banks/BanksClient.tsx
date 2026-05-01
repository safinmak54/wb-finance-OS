"use client";

import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmt, fmtDate } from "@/lib/format";
import {
  createBankConnection,
  updateBankConnection,
  deleteBankConnection,
} from "@/actions/banks";
import { ALL_ENTITY_CODES } from "@/lib/entities";
import type { BankConnection } from "@/lib/supabase/types";

type Props = { banks: BankConnection[] };

export function BanksClient({ banks }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<BankConnection | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)}>
          + Connect bank
        </Button>
      </div>

      {banks.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-xs text-muted">
              No bank connections yet. Add one to start tracking balances.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {banks.map((b) => (
            <Card key={b.id}>
              <CardHeader
                title={b.institution}
                subtitle={`${b.entity ?? "—"} · ${b.account_number ?? "—"}`}
                actions={
                  <button
                    type="button"
                    className="text-[11px] font-medium text-info hover:underline"
                    onClick={() => setEditing(b)}
                  >
                    Edit
                  </button>
                }
              />
              <CardBody>
                <div className="font-mono text-xl font-semibold">
                  {fmt(Number(b.current_balance ?? 0))}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  Last synced{" "}
                  {b.last_synced ? fmtDate(b.last_synced) : "never"} · status{" "}
                  {b.status ?? "—"}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <BankFormModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmitted={() => {
          setShowAdd(false);
          toast.push("Bank connection added", "success");
        }}
        mode="create"
      />

      <BankFormModal
        key={editing?.id ?? "edit-empty"}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSubmitted={() => {
          setEditing(null);
          toast.push("Bank connection updated", "success");
        }}
        mode="edit"
        initial={editing}
      />
    </div>
  );
}

type FormProps = {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  mode: "create" | "edit";
  initial?: BankConnection | null;
};

function BankFormModal({ open, onClose, onSubmitted, mode, initial }: FormProps) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [institution, setInstitution] = useState(initial?.institution ?? "");
  const [entity, setEntity] = useState(initial?.entity ?? "");
  const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? "");
  const [balance, setBalance] = useState(
    initial?.current_balance != null ? String(initial.current_balance) : "",
  );
  const [status, setStatus] = useState(initial?.status ?? "connected");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          institution,
          entity: entity || undefined,
          account_number: accountNumber || undefined,
          current_balance: balance ? Number(balance) : undefined,
          status,
        };
        if (mode === "create") {
          await createBankConnection(payload);
        } else if (initial) {
          await updateBankConnection({ id: initial.id, ...payload });
        }
        onSubmitted();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(`Disconnect ${initial.institution}?`)) return;
    try {
      await deleteBankConnection(initial.id);
      onSubmitted();
      toast.push("Bank disconnected", "success");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Connect bank" : "Edit connection"}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label="Institution">
          <TextInput
            required
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="e.g. Chase"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entity">
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">—</option>
              {ALL_ENTITY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Account number">
            <TextInput
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="last 4"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Current balance">
            <TextInput
              type="number"
              step="0.01"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="connected">Connected</option>
              <option value="error">Error</option>
              <option value="disconnected">Disconnected</option>
            </Select>
          </Field>
        </div>

        {error ? <div className="text-[11px] text-danger">{error}</div> : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          {mode === "edit" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-danger"
              disabled={pending}
            >
              Disconnect
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {mode === "create" ? "Connect" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
