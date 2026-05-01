"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { ENTITY_FILTER_OPTIONS, type EntityFilterValue } from "@/lib/entities";

/**
 * Entity selector. Pushes the selection to the URL `?entity=…` so it
 * survives navigation and is readable from any Server Component.
 */
export function EntitySwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const value = (params.get("entity") ?? "all") as EntityFilterValue;

  function onChange(next: EntityFilterValue) {
    const sp = new URLSearchParams(params.toString());
    if (next === "all") sp.delete("entity");
    else sp.set("entity", next);
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <select
      aria-label="Entity filter"
      value={value}
      onChange={(e) => onChange(e.target.value as EntityFilterValue)}
      disabled={pending}
      className="h-8 min-w-[180px] rounded-md border border-border bg-surface px-2 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
    >
      {ENTITY_FILTER_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
