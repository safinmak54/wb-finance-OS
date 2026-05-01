type Props = {
  title: string;
  description?: string;
};

export function Placeholder({ title, description }: Props) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-xs text-muted">
        {description ?? "Page implementation pending. Wired only for navigation and role gating."}
      </p>
    </div>
  );
}
