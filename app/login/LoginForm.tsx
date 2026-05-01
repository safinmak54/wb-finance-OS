"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next ?? ""} />

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      {state.error ? (
        <p
          role="alert"
          className="text-center text-xs font-medium text-danger"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
