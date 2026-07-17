"use client";

import { useRef, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ALL_ENTITY_CODES } from "@/lib/entities";
import {
  previewImport,
  commitImport,
  deleteAllTransactions,
  deleteAllFinancialData,
  type ParsePreview,
} from "@/actions/import";
import type { BankConnection } from "@/lib/supabase/types";

const CORE_FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount", required: true },
] as const;

// Bank rows resolve direction from a Type column and entity from the
// vendor/payee. Credit-card rows have neither — direction comes purely
// from the amount sign and entity from the account number — so the card
// field set swaps those two for an "Account #" mapping.
const BANK_FIELDS = [
  { key: "type", label: "Type (Debit/Credit)", required: false },
  { key: "vendor", label: "Vendor / payee", required: false },
] as const;
const CREDIT_CARD_FIELDS = [
  { key: "account", label: "Account # (entity mapping)", required: false },
] as const;

type Mapping = {
  date: number;
  description: number;
  amount: number;
  type: number;
  vendor: number;
  account: number;
};

type Props = {
  banks?: BankConnection[];
  onComplete?: () => void;
  isAdmin?: boolean;
};

export function ImportClient({ banks = [], onComplete, isAdmin = false }: Props = {}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<"bank" | "credit_card">("bank");
  const [defaultEntity, setDefaultEntity] = useState("");
  const [bankConnectionId, setBankConnectionId] = useState("");
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({
    date: -1,
    description: -1,
    amount: -1,
    type: -1,
    vendor: -1,
    account: -1,
  });

  const fields =
    source === "credit_card"
      ? [...CORE_FIELDS, ...CREDIT_CARD_FIELDS]
      : [...CORE_FIELDS, ...BANK_FIELDS];
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [wiping, startWipeTransition] = useTransition();
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, startResetTransition] = useTransition();

  function wipeAll() {
    if (wipeConfirm.trim().toUpperCase() !== "DELETE") {
      setError("Type DELETE to confirm the wipe");
      return;
    }
    setError(null);
    startWipeTransition(async () => {
      try {
        const r = await deleteAllTransactions();
        toast.push(
          `Deleted ${r.transactions} transactions and ${r.rawTransactions} raw rows`,
          "success",
        );
        setWipeConfirm("");
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function resetAll() {
    if (resetConfirm.trim().toUpperCase() !== "RESET") {
      setError("Type RESET to confirm the full reset");
      return;
    }
    setError(null);
    startResetTransition(async () => {
      try {
        const r = await deleteAllFinancialData();
        toast.push(
          `Deleted ${r.transactions} transactions, ${r.rawTransactions} raw rows, and ${r.cashbookSnapshots} cashbook snapshots`,
          "success",
        );
        setResetConfirm("");
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(null);
  }

  function previewFile() {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setError(null);
    startTransition(async () => {
      try {
        const p = await previewImport(fd);
        setPreview(p);
        setMapping({
          date: p.detected.date,
          description: p.detected.description,
          amount: p.detected.amount,
          type: p.detected.type,
          vendor: p.detected.vendor,
          account: p.detected.account,
        });
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  function commit() {
    if (!file) {
      setError("Choose a file first");
      return;
    }
    if (!preview) {
      setError("Click Preview before importing");
      return;
    }
    if (mapping.date < 0 || mapping.description < 0 || mapping.amount < 0) {
      setError("Map Date, Description, and Amount");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append(
      "meta",
      JSON.stringify({
        source,
        defaultEntity: defaultEntity || undefined,
        bankConnectionId: bankConnectionId || undefined,
        mapping,
      }),
    );
    setError(null);
    startTransition(async () => {
      try {
        const r = await commitImport(fd);
        if (r.inserted === 0 && r.skipped > 0) {
          setError(
            `All ${r.skipped} rows were skipped — most likely the Date or Amount column couldn't be parsed. Double-check the column mapping.`,
          );
          return;
        }
        toast.push(`Imported ${r.inserted} · skipped ${r.skipped}`, "success");
        setFile(null);
        setPreview(null);
        setBankConnectionId("");
        if (fileRef.current) fileRef.current.value = "";
        onComplete?.();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="1. Upload a file" subtitle="CSV or XLSX" />
        <CardBody className="flex flex-col gap-3">
          <label
            htmlFor="import-file"
            className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-6 text-center transition hover:border-primary hover:bg-primary/10"
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
              aria-hidden
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div className="text-sm font-semibold text-foreground">
              {file ? file.name : "Click to choose a CSV or XLSX file"}
            </div>
            <div className="text-[11px] text-muted">
              {file
                ? "Click again to pick a different file"
                : "Accepts .csv, .xlsx, .xls, .txt"}
            </div>
            <input
              id="import-file"
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              onChange={onFileChange}
              className="sr-only"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <Select
                value={source}
                onChange={(e) => setSource(e.target.value as "bank" | "credit_card")}
              >
                <option value="bank">Bank statement</option>
                <option value="credit_card">Credit card</option>
              </Select>
            </Field>
            <Field label="Default entity (optional)">
              <Select
                value={defaultEntity}
                onChange={(e) => setDefaultEntity(e.target.value)}
              >
                <option value="">— auto-detect —</option>
                {ALL_ENTITY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {banks.length > 0 ? (
            <Field label="Bank account (optional)">
              <Select
                value={bankConnectionId}
                onChange={(e) => setBankConnectionId(e.target.value)}
              >
                <option value="">— none —</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.institution}
                    {b.account_number ? ` · ${b.account_number}` : ""}
                    {b.entity ? ` (${b.entity})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Button size="sm" onClick={previewFile} disabled={!file} loading={pending}>
            {pending ? "Previewing…" : "Preview"}
          </Button>
        </CardBody>
      </Card>

      {preview ? (
        <Card>
          <CardHeader
            title="2. Map columns"
            subtitle="Confirm or override the auto-detected fields"
          />
          <CardBody className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <Field
                  key={f.key}
                  label={`${f.label}${f.required ? " *" : ""}`}
                >
                  <Select
                    value={String(mapping[f.key])}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))
                    }
                  >
                    <option value="-1">— none —</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-[11px]">
                <thead className="bg-surface-2 uppercase tracking-wider text-muted">
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} className="px-2 py-1 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {row.map((c, j) => (
                        <td key={j} className="px-2 py-1">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error ? (
              <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                {error}
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={commit} disabled={pending} loading={pending}>
                {pending ? "Importing…" : "Import"}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader
            title="Danger zone"
            subtitle="Irreversibly delete every transaction and raw row"
          />
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Wipes <strong>all rows</strong> from <code>transactions</code> and{" "}
              <code>raw_transactions</code>. This cannot be undone. Type{" "}
              <code>DELETE</code> below to enable the button.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Type DELETE to confirm" className="flex-1">
                <TextInput
                  value={wipeConfirm}
                  onChange={(e) => setWipeConfirm(e.target.value)}
                  placeholder="DELETE"
                  disabled={wiping}
                />
              </Field>
              <Button
                variant="danger"
                onClick={wipeAll}
                disabled={
                  wiping || wipeConfirm.trim().toUpperCase() !== "DELETE"
                }
              >
                {wiping ? "Deleting…" : "Delete all transactions"}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader
            title="Full reset"
            subtitle="Delete transactions, raw rows, and cashbook snapshots"
          />
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Wipes <strong>all rows</strong> from <code>transactions</code>,{" "}
              <code>raw_transactions</code>, and <code>cashbook_snapshots</code>.
              The <code>transactions_pnl</code> and{" "}
              <code>cashbook_snapshots_latest</code> views are derived from those
              tables and will clear automatically. This cannot be undone. Type{" "}
              <code>RESET</code> below to enable the button.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Type RESET to confirm" className="flex-1">
                <TextInput
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  placeholder="RESET"
                  disabled={resetting}
                />
              </Field>
              <Button
                variant="danger"
                onClick={resetAll}
                disabled={
                  resetting || resetConfirm.trim().toUpperCase() !== "RESET"
                }
              >
                {resetting ? "Resetting…" : "Delete everything"}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
