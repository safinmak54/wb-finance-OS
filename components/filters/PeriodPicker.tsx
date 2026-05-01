"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const OPTIONS: Array<{ value: string; label: string }> = [
  { value: "month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "qtd", label: "QTD" },
  { value: "ytd", label: "YTD" },
];

/**
 * Period selector. Pushes `?period=…` to the URL so any Server
 * Component can read it. Companion to <EntitySwitcher>.
 */
export function PeriodPicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const value = params.get("period") ?? "month";

  function onChange(next: string) {
    const sp = new URLSearchParams(params.toString());
    if (next === "month") sp.delete("period");
    else sp.set("period", next);
    sp.delete("from");
    sp.delete("to");
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <select
      aria-label="Period filter"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={pending}
      className="h-8 min-w-[120px] rounded-md border border-border bg-surface px-2 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
    >
      {OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
