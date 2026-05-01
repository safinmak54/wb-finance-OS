"use client";

import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { fmtDate } from "@/lib/format";
import {
  createCfoNote,
  updateCfoNote,
  deleteCfoNote,
} from "@/actions/cfnotes";
import { ALL_ENTITY_CODES } from "@/lib/entities";
import type { CfoNote } from "@/lib/supabase/types";

type Props = { notes: CfoNote[] };

export function CfNotesClient({ notes }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<CfoNote | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAdd(true)}>
          + New note
        </Button>
      </div>

      {notes.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-xs text-muted">
              No notes yet. Add commentary, tax-planning items, or GAAP footnotes.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {notes.map((n) => (
            <Card key={n.id}>
              <CardHeader
                title={`${n.period}${n.entity ? ` · ${n.entity}` : ""}`}
                subtitle={fmtDate(n.created_at)}
                actions={
                  <button
                    type="button"
                    className="text-[11px] font-medium text-info hover:underline"
                    onClick={() => setEditing(n)}
                  >
                    Edit
                  </button>
                }
              />
              <CardBody>
                <p className="whitespace-pre-wrap text-xs text-foreground">
                  {n.content}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <NoteFormModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmitted={() => {
          setShowAdd(false);
          toast.push("Note saved", "success");
        }}
        mode="create"
      />

      <NoteFormModal
        key={editing?.id ?? "edit-empty"}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSubmitted={() => {
          setEditing(null);
          toast.push("Note saved", "success");
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
  initial?: CfoNote | null;
};

function NoteFormModal({ open, onClose, onSubmitted, mode, initial }: FormProps) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useState(
    initial?.period ?? new Date().toISOString().slice(0, 7),
  );
  const [entity, setEntity] = useState(initial?.entity ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          period,
          entity: entity || undefined,
          content,
        };
        if (mode === "create") {
          await createCfoNote(payload);
        } else if (initial) {
          await updateCfoNote({ id: initial.id, ...payload });
        }
        onSubmitted();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(`Delete this note?`)) return;
    try {
      await deleteCfoNote(initial.id);
      onSubmitted();
      toast.push("Note deleted", "success");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "create" ? "New note" : "Edit note"}
      size="lg"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period">
            <TextInput
              required
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </Field>
          <Field label="Entity">
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All</option>
              {ALL_ENTITY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Content">
          <TextArea
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="Tax planning notes, GAAP commentary, board prep…"
          />
        </Field>

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
              Delete
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
