"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { cn } from "@/lib/utils/cn";

/**
 * App-wide toggle for the secondary "% of total" annotation shown beside
 * dollar amounts (e.g. % of gross revenue in the P&L, % of total assets on
 * the balance sheet). Two states:
 *   - "$"      → dollar amounts only
 *   - "$ + %"  → dollar amounts with their companion percentage (default)
 *
 * The preference is global and persisted to localStorage, so setting it on
 * one page carries across the app.
 */

type PercentDisplay = {
  /** When true, show the companion percentage alongside dollar amounts. */
  showPct: boolean;
  setShowPct: (v: boolean) => void;
};

const Ctx = createContext<PercentDisplay | null>(null);

const STORAGE_KEY = "wb:show-pct";

export function PercentDisplayProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Default to showing both $ and % (the app's prior behavior). The persisted
  // preference is read after mount to avoid an SSR/client hydration mismatch.
  const [showPct, setShowPctState] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "0") {
        setShowPctState(false);
      }
    } catch {
      // localStorage unavailable (e.g. private mode) — keep the default.
    }
  }, []);

  const setShowPct = useCallback((v: boolean) => {
    setShowPctState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // Ignore persistence failures; the in-memory state still updates.
    }
  }, []);

  return (
    <Ctx.Provider value={{ showPct, setShowPct }}>{children}</Ctx.Provider>
  );
}

export function usePercentDisplay(): PercentDisplay {
  // Safe fallback so consumers rendered outside the provider still work,
  // defaulting to the both-shown behavior.
  return useContext(Ctx) ?? { showPct: true, setShowPct: () => {} };
}

/** Segmented `$` / `$ + %` control. Matches the app's other inline toggles. */
export function PercentToggle({ className }: { className?: string }) {
  const { showPct, setShowPct } = usePercentDisplay();
  return (
    <div
      className={cn(
        "inline-flex overflow-hidden rounded-md border border-border text-[11px]",
        className,
      )}
      role="group"
      aria-label="Value display"
    >
      <button
        type="button"
        onClick={() => setShowPct(false)}
        aria-pressed={!showPct}
        title="Show dollar amounts only"
        className={cn(
          "px-2 py-1",
          !showPct ? "bg-info-soft text-info" : "text-muted hover:bg-surface-2",
        )}
      >
        $
      </button>
      <button
        type="button"
        onClick={() => setShowPct(true)}
        aria-pressed={showPct}
        title="Show dollar amounts with % of total"
        className={cn(
          "border-l border-border px-2 py-1",
          showPct ? "bg-info-soft text-info" : "text-muted hover:bg-surface-2",
        )}
      >
        $ + %
      </button>
    </div>
  );
}
