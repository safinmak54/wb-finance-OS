import { cn } from "@/lib/utils/cn";
import { fmtPct } from "@/lib/format";

export function Card({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface shadow-card",
        className,
      )}
      {...rest}
    />
  );
}

type CardHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
};

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
  children,
  ...rest
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
      {...rest}
    >
      <div className="min-w-0 flex-1">
        {title ? (
          <h3 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
        ) : null}
        {subtitle ? (
          <p className="truncate text-[11px] text-muted">{subtitle}</p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...rest} />;
}

/** Period-over-period change shown under a Stat value. `pct` is null when
 *  the comparison base is zero (no meaningful percentage). `favorable`
 *  decides the color — for cost metrics a decrease is favorable. */
export type StatChange = {
  pct: number | null;
  favorable: boolean;
  label: string;
};

type StatProps = {
  label: string;
  value: string;
  delta?: string;
  tone?: "default" | "positive" | "negative" | "warning";
  /** Bold (700) the value instead of the default semibold (600). */
  strong?: boolean;
  /** Optional period-over-period comparison (MoM / YoY). */
  change?: StatChange;
  /** When provided, the card becomes a clickable button (e.g. to open a
   *  detail drawer). */
  onClick?: () => void;
};

export function Stat({
  label,
  value,
  delta,
  tone = "default",
  strong = false,
  change,
  onClick,
}: StatProps) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-success",
    negative: "text-danger",
    warning: "text-warning",
  }[tone];

  const interactive = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface p-4 shadow-card",
        onClick &&
          "cursor-pointer transition hover:border-border-strong hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-info",
      )}
      {...interactive}
    >
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
        {label}
      </div>
      <div
        className={cn(
          "mt-1.5 font-mono text-xl",
          strong ? "font-bold" : "font-semibold",
          toneClass,
        )}
      >
        {value}
      </div>
      {delta ? (
        <div className="mt-0.5 text-[11px] text-muted">{delta}</div>
      ) : null}
      {change ? (
        <div className="mt-0.5 flex items-center gap-1 text-[11px]">
          {change.pct === null ? (
            <span className="text-muted">— {change.label}</span>
          ) : (
            <>
              <span
                className={cn(
                  "font-medium",
                  change.favorable ? "text-success" : "text-danger",
                )}
              >
                {change.pct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(change.pct))}
              </span>
              <span className="text-muted">{change.label}</span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
