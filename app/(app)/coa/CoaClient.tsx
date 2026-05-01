"use client";

import { useMemo, useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import {
  createAccount,
  updateAccount,
  deactivateAccount,
} from "@/actions/accounts";
import type { AccountWithBalance } from "@/lib/queries/accounts";

type Props = { accounts: AccountWithBalance[] };

const TYPE_BADGE: Record<string, string> = {
  asset: "bg-info-soft text-info",
  liability: "bg-warning-soft text-warning",
  equity: "bg-purple-soft text-purple",
  revenue: "bg-success-soft text-success",
  expense: "bg-danger-soft text-danger",
};

export function CoaClient({ accounts }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<AccountWithBalance | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const columns = useMemo<ColumnDef<AccountWithBalance>[]>(
    () => [
      {
        accessorKey: "account_code",
        header: "Code",
        cell: (c) => (
          <span className="font-mono text-[11px]">{c.getValue<string>()}</span>
        ),
      },
      { accessorKey: "account_name", header: "Name" },
      {
        accessorKey: "account_type",
        header: "Type",
        cell: (c) => {
          const v = c.getValue<string>();
          return (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                TYPE_BADGE[v] ?? "bg-surface-2 text-muted",
              )}
            >
              {v}
            </span>
          );
        },
      },
      { accessorKey: "account_subtype", header: "Subtype" },
      {
        accessorKey: "normal_balance",
        header: "Normal",
        cell: (c) => (
          <span className="font-mono text-[10px] text-muted">
            {c.getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: "balance",
        header: "Balance",
        cell: (c) => (
          <span className="font-mono text-right">{fmt(c.getValue<number>())}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: (c) => (
          <button
            type="button"
            className="text-[11px] font-medium text-info hover:underline"
            onClick={() => setEditing(c.row.original)}
          >
            Edit
          </button>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={accounts}
        searchPlaceholder="Search accounts…"
        toolbar={
          <Button onClick={() => setShowAdd(true)} size="sm">
            + Add account
          </Button>
        }
        rowClassName={(r) => (r.is_active ? undefined : "opacity-50")}
      />

      <AccountFormModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmitted={() => {
          setShowAdd(false);
          toast.push("Account created", "success");
        }}
        mode="create"
      />

      <AccountFormModal
        key={editing?.id ?? "edit-empty"}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSubmitted={() => {
          setEditing(null);
          toast.push("Account updated", "success");
        }}
        mode="edit"
        initial={editing}
      />
    </>
  );
}

type FormProps = {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  mode: "create" | "edit";
  initial?: AccountWithBalance | null;
};

function AccountFormModal({
  open,
  onClose,
  onSubmitted,
  mode,
  initial,
}: FormProps) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState(initial?.account_code ?? "");
  const [name, setName] = useState(initial?.account_name ?? "");
  const [type, setType] = useState<
    "asset" | "liability" | "equity" | "revenue" | "expense"
  >(initial?.account_type ?? "expense");
  const [subtype, setSubtype] = useState(initial?.account_subtype ?? "");
  const [normal, setNormal] = useState(initial?.normal_balance ?? "DEBIT");
  const [line, setLine] = useState(initial?.line ?? "");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          account_code: code,
          account_name: name,
          account_type: type as "asset" | "liability" | "equity" | "revenue" | "expense",
          account_subtype: subtype || undefined,
          normal_balance: normal as "DEBIT" | "CREDIT",
          line: line || undefined,
          is_elimination: false,
        };
        if (mode === "create") {
          await createAccount(payload);
        } else if (initial) {
          await updateAccount({ id: initial.id, ...payload });
        }
        onSubmitted();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  async function onDeactivate() {
    if (!initial) return;
    if (!confirm(`Deactivate ${initial.account_code}?`)) return;
    try {
      await deactivateAccount(initial.id);
      onSubmitted();
      toast.push("Account deactivated", "success");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "create" ? "Add account" : "Edit account"}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <TextInput
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 6010"
            />
          </Field>
          <Field label="Normal balance">
            <Select
              value={normal}
              onChange={(e) => setNormal(e.target.value as "DEBIT" | "CREDIT")}
            >
              <option value="DEBIT">DEBIT</option>
              <option value="CREDIT">CREDIT</option>
            </Select>
          </Field>
        </div>
        <Field label="Name">
          <TextInput
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Google Ads"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="asset">Asset</option>
              <option value="liability">Liability</option>
              <option value="equity">Equity</option>
              <option value="revenue">Revenue</option>
              <option value="expense">Expense</option>
            </Select>
          </Field>
          <Field label="Subtype">
            <TextInput
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              placeholder="e.g. advertising"
            />
          </Field>
        </div>
        <Field label="P&L line">
          <TextInput
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="Subtotal label"
          />
        </Field>

        {error ? <div className="text-[11px] text-danger">{error}</div> : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          {mode === "edit" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDeactivate}
              className="text-danger"
              disabled={pending}
            >
              Deactivate
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
