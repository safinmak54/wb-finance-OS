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

export function ImportClient() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<"bank" | "credit_card">("bank");
  const [defaultEntity, setDefaultEntity] = useState("");
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
    if (!file || !preview) return;
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
        mapping,
      }),
    );
    setError(null);
    startTransition(async () => {
      try {
        const r = await commitImport(fd);
        toast.push(`Imported ${r.inserted} · skipped ${r.skipped}`, "success");
        setFile(null);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
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
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            onChange={onFileChange}
            className="text-xs"
          />
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

            {error ? <div className="text-[11px] text-danger">{error}</div> : null}

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
