import { forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-primary/60",
  outline:
    "border border-border bg-surface text-foreground hover:bg-surface-2 disabled:text-muted",
  ghost:
    "text-foreground hover:bg-surface-2",
  danger:
    "bg-danger text-primary-foreground hover:bg-danger/90",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[11px]",
  md: "h-8 px-3 text-xs",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
});
