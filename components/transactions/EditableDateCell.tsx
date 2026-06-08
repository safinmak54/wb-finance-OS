"use client";

import { useState, useTransition } from "react";
import { fmtDateShort, normalizeDate } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

/**
 * Inline-editable accounting date for a bank/ledger row.
 *
 * `date` is the effective accounting date shown; `originalDate` is the
 * immutable bank date. When the two differ the cell renders in the
 * warning color with a dot, signalling the date was deliberately moved
 * (e.g. an expense accrued into a different period). The change is fully
 * reversible — the ↺ control writes `originalDate` back.
 *
 * The parent owns persistence via `onSave`, which should throw on
 * failure so the editor stays open for a retry.
 */
export function EditableDateCell({
  date,
  originalDate,
  onSave,
  disabled,
}: {
  date: string;
  originalDate: string;
  onSave: (newDate: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => normalizeDate(date));
  const [pending, startTransition] = useTransition();

  const normDate = normalizeDate(date);
  const normOriginal = normalizeDate(originalDate);
  const changed = Boolean(normOriginal) && normDate !== normOriginal;

  function commit(next: string) {
    const normNext = normalizeDate(next);
    if (!normNext || normNext === normDate) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        await onSave(normNext);
        setEditing(false);
      } catch {
        // onSave surfaces its own error; keep the editor open to retry.
      }
    });
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="date"
          autoFocus
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(value);
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-6 rounded border border-border bg-surface px-1 font-mono text-[11px]"
        />
        <button
          type="button"
          disabled={pending}
          title="Save"
          onClick={() => commit(value)}
          className="text-[11px] font-medium text-info hover:underline"
        >
          ✓
        </button>
        {changed ? (
          <button
            type="button"
            disabled={pending}
            title={`Revert to bank date ${fmtDateShort(originalDate)}`}
            onClick={() => commit(normOriginal)}
            className="text-[11px] text-muted hover:text-info"
          >
            ↺
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          title="Cancel"
          onClick={() => setEditing(false)}
          className="text-[11px] text-muted hover:underline"
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() => {
        setValue(normDate);
        setEditing(true);
      }}
      title={
        changed
          ? `Date changed — bank date was ${fmtDateShort(originalDate)}. Click to edit or revert.`
          : "Click to change accounting date"
      }
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 font-mono text-[11px] hover:bg-surface-2 disabled:opacity-50",
        changed && "font-semibold text-warning",
      )}
    >
      {fmtDateShort(date)}
      {changed ? (
        <span aria-hidden className="text-[8px] text-warning">
          ●
        </span>
      ) : null}
    </button>
  );
}
