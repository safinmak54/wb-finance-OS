"use client";

import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, TextInput, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import {
  upsertClassificationRule,
  deleteClassificationRule,
} from "@/actions/classify";
import type { Account, ClassificationRule } from "@/lib/supabase/types";

type AccountOpt = {
  id: string;
  code: string;
  name: string;
  type: Account["account_type"];
};

type Props = {
  rules: ClassificationRule[];
  accounts: AccountOpt[];
};

export function RulesClient({ rules, accounts }: Props) {
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [pattern, setPattern] = useState("");
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");

  function reset() {
    setEditingId(null);
    setPattern("");
    setAccountId("");
  }

  function startEdit(r: ClassificationRule) {
    setEditingId(r.id);
    setPattern(r.pattern);
    setAccountId(r.account_id ?? "");
  }

  function save() {
    if (!pattern.trim() || !accountId) {
      toast.push("Enter a pattern and pick an account", "error");
      return;
    }
    startTransition(async () => {
      try {
        await upsertClassificationRule({
          id: editingId ?? undefined,
          pattern: pattern.trim(),
          account_id: accountId,
          is_active: true,
        });
        toast.push(editingId ? "Rule updated" : "Rule added", "success");
        reset();
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this rule?")) return;
    try {
      await deleteClassificationRule(id);
      toast.push("Rule deleted", "success");
      if (editingId === id) reset();
    } catch (err) {
      toast.push((err as Error).message, "error");
    }
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const codeFor = (r: ClassificationRule) =>
    accountById.get(r.account_id ?? "")?.code ?? "";
  const filtered = (
    search.trim()
      ? rules.filter((r) =>
          `${r.pattern} ${accountById.get(r.account_id ?? "")?.name ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
      : rules
  )
    .slice()
    .sort((a, b) => {
      // Sort by account number ascending; rules without an account sort last.
      const ca = codeFor(a);
      const cb = codeFor(b);
      if (!ca) return cb ? 1 : 0;
      if (!cb) return -1;
      return ca.localeCompare(cb, undefined, { numeric: true });
    });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={editingId ? "Edit rule" : "Add rule"}
          subtitle="Rules auto-tag a transaction when its description (or vendor) contains the pattern. First match wins."
        />
        <CardBody className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Field label="Pattern (case-insensitive)">
              <TextInput
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="e.g. GOOGLE"
              />
            </Field>
            <Field label="Account">
              <Select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">—</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={save}>
                {editingId ? "Update" : "Add"}
              </Button>
              {editingId ? (
                <Button size="sm" variant="outline" onClick={reset}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${rules.length} rule${rules.length === 1 ? "" : "s"}`}
        />
        <CardBody className="flex flex-col gap-3 p-0">
          <div className="px-4 pt-3">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules…"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Number</th>
                  <th className="px-3 py-2 text-left">Pattern</th>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-left">Active</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-muted"
                    >
                      {rules.length === 0
                        ? "No rules yet — add one above."
                        : "No matches."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const a = accountById.get(r.account_id ?? "");
                    return (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-3 py-1.5 font-mono text-[11px]">
                          {a?.code ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[11px]">
                          {r.pattern}
                        </td>
                        <td className="px-3 py-1.5">
                          {a ? `${a.code} · ${a.name}` : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-muted">
                          {r.is_active ? "Yes" : "No"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          <button
                            type="button"
                            className="mr-3 text-[11px] font-medium text-info hover:underline"
                            onClick={() => startEdit(r)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-[11px] font-medium text-danger hover:underline"
                            onClick={() => onDelete(r.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
