import { cn } from "@/lib/utils/cn";

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

type StatProps = {
  label: string;
  value: string;
  delta?: string;
  tone?: "default" | "positive" | "negative" | "warning";
};

export function Stat({ label, value, delta, tone = "default" }: StatProps) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-success",
    negative: "text-danger",
    warning: "text-warning",
  }[tone];

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
        {label}
      </div>
      <div className={cn("mt-1.5 font-mono text-xl font-semibold", toneClass)}>
        {value}
      </div>
      {delta ? (
        <div className="mt-0.5 text-[11px] text-muted">{delta}</div>
      ) : null}
    </div>
  );
}
