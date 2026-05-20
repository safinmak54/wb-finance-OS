"use client";

import { useRef, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ALL_ENTITY_CODES } from "@/lib/entities";
import {
  previewImport,
  commitImport,
  type ParsePreview,
} from "@/actions/import";
import type { BankConnection } from "@/lib/supabase/types";

const FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount (signed)", required: false },
  { key: "debit", label: "Debit column", required: false },
  { key: "credit", label: "Credit column", required: false },
  { key: "vendor", label: "Vendor / payee", required: false },
] as const;

type Mapping = {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  vendor: number;
};

type Props = {
  banks?: BankConnection[];
  onComplete?: () => void;
};

export function ImportClient({ banks = [], onComplete }: Props = {}) {
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
    debit: -1,
    credit: -1,
    vendor: -1,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
          debit: p.detected.debit,
          credit: p.detected.credit,
          vendor: p.detected.vendor,
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
    const hasAmount = mapping.amount >= 0 || (mapping.debit >= 0 || mapping.credit >= 0);
    if (mapping.date < 0 || mapping.description < 0 || !hasAmount) {
      setError("Map Date, Description, and either Amount OR Debit+Credit");
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
          <Button size="sm" onClick={previewFile} disabled={!file || pending}>
            Preview
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
              {FIELDS.map((f) => (
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
              <Button onClick={commit} disabled={pending}>
                Import
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
