import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils/cn";

export type StatementLine = {
  label: string;
  amount: number;
  emphasis?: "subtotal" | "total" | "muted";
};

type Props = {
  title: string;
  lines: StatementLine[];
  total?: number;
  totalLabel?: string;
};

export function StatementSection({ title, lines, total, totalLabel }: Props) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </div>
      <div>
        {lines.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted">No activity.</div>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((l, i) => (
              <li
                key={`${l.label}-${i}`}
                className={cn(
                  "flex items-center justify-between px-4 py-1.5 text-xs",
                  l.emphasis === "subtotal" &&
                    "bg-surface-2 font-semibold text-foreground",
                  l.emphasis === "total" &&
                    "bg-primary text-primary-foreground font-semibold",
                  l.emphasis === "muted" && "text-muted",
                )}
              >
                <span>{l.label}</span>
                <span className="font-mono">{fmt(l.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {total !== undefined ? (
          <div className="flex items-center justify-between border-t border-border bg-surface-2 px-4 py-2 text-xs font-semibold">
            <span>{totalLabel ?? "Total"}</span>
            <span
              className={cn(
                "font-mono",
                total < 0 ? "text-danger" : "text-foreground",
              )}
            >
              {fmt(total)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
