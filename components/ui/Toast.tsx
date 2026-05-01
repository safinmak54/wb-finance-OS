"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/utils/cn";

type Toast = {
  id: number;
  message: string;
  variant: "info" | "success" | "error" | "warning";
};

type ToastContext = {
  push: (message: string, variant?: Toast["variant"]) => void;
};

const Ctx = createContext<ToastContext | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback(
    (message: string, variant: Toast["variant"] = "info") => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, message, variant }]);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 3500);
    },
    [],
  );

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-md px-3 py-2 text-xs font-medium shadow-pop",
              t.variant === "success" &&
                "bg-success-soft text-success border border-success/30",
              t.variant === "error" &&
                "bg-danger-soft text-danger border border-danger/30",
              t.variant === "warning" &&
                "bg-warning-soft text-warning border border-warning/30",
              t.variant === "info" &&
                "bg-info-soft text-info border border-info/30",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
