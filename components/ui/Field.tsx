import { cn } from "@/lib/utils/cn";

type FieldProps = {
  label?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
};

export function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      {label ? (
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
          {label}
        </span>
      ) : null}
      {children}
      {error ? (
        <span className="text-[11px] text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[11px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "h-8 w-full rounded-md border border-border bg-surface px-2.5 text-xs text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-surface-2";

export const selectClass = inputClass;

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(selectClass, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-[72px] w-full rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20",
        props.className,
      )}
    />
  );
}
