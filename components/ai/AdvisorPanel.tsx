"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

type Message = { role: "user" | "assistant"; content: string };

export function AdvisorPanel() {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const trimmed = input.trim();
    if (!trimmed) return;
    const next = [...history, { role: "user" as const, content: trimmed }];
    setHistory(next);
    setInput("");
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            history,
            context: {
              period: params.get("period") ?? "month",
              entity: params.get("entity") ?? "all",
            },
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Request failed");
          return;
        }
        setHistory([...next, { role: "assistant", content: json.text }]);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed right-4 top-1/2 z-30 -translate-y-1/2 rounded-l-md border border-border bg-primary px-2 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow-pop hover:bg-primary-hover",
          open && "right-[400px]",
        )}
        title="AI advisor"
      >
        AI
      </button>

      <aside
        className={cn(
          "fixed right-0 top-0 z-20 flex h-screen w-[400px] flex-col border-l border-border bg-surface shadow-pop transition-transform",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Advisor</h2>
          <button
            type="button"
            className="text-[11px] text-muted hover:text-foreground"
            onClick={() => setHistory([])}
          >
            Clear
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {history.length === 0 ? (
            <p className="text-xs text-muted">
              Ask anything about the current period&apos;s financials. The
              advisor sees revenue, expenses, cash position, open invoices.
            </p>
          ) : (
            history.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md px-3 py-2 text-xs",
                  m.role === "user"
                    ? "self-end bg-primary text-primary-foreground"
                    : "self-start bg-surface-2 text-foreground",
                )}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))
          )}

          {pending ? (
            <div className="self-start rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
              Thinking…
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          ) : null}
        </div>

        <div className="border-t border-border px-3 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Ask…"
              className="min-h-[44px] flex-1 resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <Button size="sm" onClick={send} disabled={pending || !input.trim()}>
              Send
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
