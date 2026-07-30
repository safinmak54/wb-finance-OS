"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { useTxnQuery } from "./useTxnQuery";
import type { TxnFunnelCounts, TxnTab } from "./txn-tabs";

type Props = {
  /** Active card, resolved server-side from `?tab=`. */
  tab: TxnTab;
  /** Row count behind each card, for the current entity + month window. */
  counts: TxnFunnelCounts;
  /** Bank rows can be internal transfers; credit-card rows can only be
   *  payments — the Set Aside description says so. */
  side: "bank" | "cc";
};

type CardSpec = {
  key: TxnTab;
  name: string;
  description: string;
  icon: ReactNode;
  /** Tint for the icon chip + the selected state. */
  tone: "info" | "purple" | "warning" | "success" | "primary";
  /** Draw a flow arrow after this card. */
  arrow: boolean;
};

const TONE_CLASSES = {
  info: { chip: "bg-info-soft text-info", active: "border-info bg-info-soft" },
  purple: {
    chip: "bg-purple-soft text-purple",
    active: "border-purple bg-purple-soft",
  },
  warning: {
    chip: "bg-warning-soft text-warning",
    active: "border-warning bg-warning-soft",
  },
  success: {
    chip: "bg-success-soft text-success",
    active: "border-success bg-success-soft",
  },
  primary: {
    chip: "bg-primary-soft text-primary",
    active: "border-primary bg-primary-soft",
  },
} as const;

/** The five funnel cards above the transaction table. Each card is a filter:
 *  clicking one writes `?tab=` and the server re-fetches that slice. */
export function TxnFunnelCards({ tab, counts, side }: Props) {
  const { pushWith, isPending } = useTxnQuery();

  const cards: CardSpec[] = [
    {
      key: "all",
      name: "All Transactions",
      description: "Every row in view — finalized, set aside and still open.",
      icon: <IconList />,
      tone: "info",
      arrow: true,
    },
    {
      key: "set_aside",
      name: "Set Aside",
      description:
        side === "bank"
          ? "Internal transfers and card payments — parked, never posted."
          : "Card payments — parked, never posted to the GL.",
      icon: <IconArchive />,
      tone: "purple",
      arrow: true,
    },
    {
      key: "to_classify",
      name: "To Classify",
      description: "Open rows still waiting for an account.",
      icon: <IconInbox />,
      tone: "warning",
      arrow: true,
    },
    {
      key: "auto",
      name: "Auto-tagged",
      description: "A rule matched — account pre-filled, just confirm.",
      icon: <IconBolt />,
      tone: "success",
      arrow: false,
    },
    {
      key: "manual",
      name: "Manual",
      description: "No rule matched — pick the account by hand.",
      icon: <IconPencil />,
      tone: "primary",
      arrow: false,
    },
  ];

  return (
    <div className="mb-3 flex flex-wrap items-stretch gap-2">
      {cards.map((c) => {
        const active = tab === c.key;
        const tone = TONE_CLASSES[c.tone];
        return (
          <Fragment key={c.key}>
            <button
              type="button"
              // Picking a card resets both chip rows, so you never land on an
              // impossible intersection (e.g. Manual ∩ Internal Transfers).
              onClick={() =>
                pushWith({ tab: c.key, status: null, kind: null })
              }
              disabled={isPending}
              aria-pressed={active}
              className={cn(
                "group flex min-w-[168px] flex-1 basis-0 flex-col rounded-xl border p-3 text-left shadow-card transition",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-info",
                active
                  ? cn(tone.active, "shadow-pop")
                  : "border-border bg-surface hover:-translate-y-px hover:border-border-strong hover:shadow-pop",
                isPending && "opacity-60",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                    active ? "bg-surface/70 text-foreground" : tone.chip,
                  )}
                >
                  {c.icon}
                </span>
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {c.name}
                </span>
              </span>
              <span className="mt-2 font-mono text-2xl font-semibold leading-none tabular-nums text-foreground">
                {counts[c.key].toLocaleString()}
              </span>
              <span className="mt-1.5 text-[11px] leading-snug text-muted">
                {c.description}
              </span>
            </button>
            {c.arrow ? <FlowArrow /> : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function FlowArrow() {
  return (
    <span
      aria-hidden="true"
      className="hidden shrink-0 items-center self-center text-subtle sm:flex"
    >
      <Svg>
        <path d="M4 12h14" />
        <path d="m13 6 6 6-6 6" />
      </Svg>
    </span>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function IconList() {
  return (
    <Svg>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </Svg>
  );
}

function IconArchive() {
  return (
    <Svg>
      <path d="M3 5h18v4H3z" />
      <path d="M5 9v10h14V9" />
      <path d="M10 13h4" />
    </Svg>
  );
}

function IconInbox() {
  return (
    <Svg>
      <path d="M4 13h4l2 3h4l2-3h4" />
      <path d="M6 4h12l3 9v7H3v-7z" />
    </Svg>
  );
}

function IconBolt() {
  return (
    <Svg>
      <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z" />
    </Svg>
  );
}

function IconPencil() {
  return (
    <Svg>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Svg>
  );
}
