"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ROLES } from "@/lib/auth/permissions";
import { createUser, type CreateUserState } from "./actions";

const ROLE_LABEL = {
  coo: "COO",
  bookkeeper: "Bookkeeper",
  cpa: "CPA",
  admin: "Admin",
} as const;

const initialState: CreateUserState = {};

export function CreateUserButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
      >
        + Add user
      </button>
      {open ? <CreateUserDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(createUser, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Close the dialog automatically once the action succeeds.
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-user-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-pop">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="create-user-title" className="text-base font-semibold text-foreground">
              Add user
            </h2>
            <p className="mt-1 text-xs text-muted">
              Create a Supabase login with an initial password. Share it with
              the user out-of-band — they can change it after first sign-in.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground"
          >
            ×
          </button>
        </div>

        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <Field label="Email">
            <input
              type="email"
              name="email"
              required
              autoComplete="off"
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </Field>

          <Field label="Display name (optional)">
            <input
              type="text"
              name="displayName"
              maxLength={80}
              autoComplete="off"
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </Field>

          <Field label="Initial password">
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <span className="mt-1 text-[11px] text-subtle">Minimum 8 characters.</span>
          </Field>

          <Field label="Role">
            <select
              name="role"
              defaultValue="bookkeeper"
              required
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>

          {state.error ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {state.error}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
