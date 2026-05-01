"use client";

import { useMemo, useState, useTransition } from "react";
import { saveCashBalance } from "@/actions/cash";
import { useToast } from "@/components/ui/Toast";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils/cn";
import type { CashBalance } from "@/lib/supabase/types";

const ENTITIES = [
  "WB Brands",
  "Koolers Promo",
  "WB Promo",
  "Band Promo",
  "Lanyard Promo",
  "SP Brands",
  "One Ops",
] as const;

type Col = {
  key: string;
  label: string;
  section: 1 | 2;
  payable?: boolean;
};

const COLUMNS: Col[] = [
  { key: "tfb", label: "TFB", section: 1 },
  { key: "hunt", label: "Huntington", section: 1 },
  { key: "vend_pay", label: "Vendor Pay", section: 1 },
  { key: "cc", label: "CC", section: 1 },
  { key: "int_xfer", label: "Int Transfer", section: 1 },
  { key: "google", label: "Google / Agencies", section: 1 },
  { key: "hunt_bal", label: "Hunt. Bal", section: 1 },
  { key: "cc_pay", label: "Credit Card", section: 2, payable: true },
  { key: "vend_pmts", label: "Vendor Pmts", section: 2, payable: true },
  { key: "goog_pend", label: "Google Pending", section: 2, payable: true },
  { key: "fedex", label: "FedEx / ASI", section: 2, payable: true },
  { key: "stripe_pp", label: "Stripe + PayPal", section: 2 },
];

type Props = { rows: CashBalance[] };

export function CashBalancesClient({ rows }: Props) {
  const toast = useToast();
  const [, startTransition] = useTransition();

  const initial = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      m.set(`${r.entity}_${r.col_key}`, Number(r.value ?? 0));
    }
    return m;
  }, [rows]);

  const [values, setValues] = useState(initial);

  function getVal(entity: string, key: string): number {
    return values.get(`${entity}_${key}`) ?? 0;
  }

  function commit(entity: string, key: string, raw: string) {
    const cleaned = raw.replace(/[$,()]/g, "").trim();
    const next = cleaned === "" ? null : Number(cleaned) || 0;
    const k = `${entity}_${key}`;
    const m = new Map(values);
    if (next === null || next === 0) m.delete(k);
    else m.set(k, next);
    setValues(m);

    startTransition(async () => {
      try {
        await saveCashBalance({ entity, col_key: key, value: next });
      } catch (err) {
        toast.push((err as Error).message, "error");
      }
    });
  }

  function fmtCell(value: number, payable: boolean | undefined) {
    if (!value) return "";
    const color = payable
      ? "text-danger"
      : value < 0
        ? "text-danger"
        : "text-success";
    return (
      <span className={cn("font-mono text-xs font-semibold", color)}>
        {payable ? `(${fmt(Math.abs(value))})` : fmt(value)}
      </span>
    );
  }

  function rowFor(entity: string, isTotal: boolean) {
    const cells = COLUMNS.map((col) => {
      const value = isTotal
        ? ENTITIES.reduce((s, e) => s + (col.payable ? -Math.abs(getVal(e, col.key)) : getVal(e, col.key)), 0)
        : col.payable
          ? -Math.abs(getVal(entity, col.key))
          : getVal(entity, col.key);
      return { col, value };
    });

    const cashTotal = isTotal
      ? ENTITIES.reduce(
          (s, e) =>
            s +
            COLUMNS.filter((c) => c.section === 1).reduce(
              (ss, c) => ss + getVal(e, c.key),
              0,
            ),
          0,
        )
      : COLUMNS.filter((c) => c.section === 1).reduce(
          (s, c) => s + getVal(entity, c.key),
          0,
        );

    const totalPayables = isTotal
      ? ENTITIES.reduce(
          (s, e) =>
            s +
            COLUMNS.filter((c) => c.payable).reduce(
              (ss, c) => ss + Math.abs(getVal(e, c.key)),
              0,
            ),
          0,
        )
      : COLUMNS.filter((c) => c.payable).reduce(
          (s, c) => s + Math.abs(getVal(entity, c.key)),
          0,
        );

    const stripe = isTotal
      ? ENTITIES.reduce((s, e) => s + getVal(e, "stripe_pp"), 0)
      : getVal(entity, "stripe_pp");

    const cashBal = cashTotal - totalPayables + stripe;

    return (
      <tr
        key={isTotal ? "total" : entity}
        className={cn(
          "border-t border-border",
          isTotal && "bg-surface-2 font-semibold",
        )}
      >
        <td className="whitespace-nowrap px-3 py-1.5 text-xs font-semibold">
          {isTotal ? "Total" : entity}
        </td>
        {cells.slice(0, 7).map(({ col, value }) => (
          <td key={col.key} className="px-2 py-1 text-right">
            {isTotal ? (
              fmtCell(value, col.payable)
            ) : (
              <span
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) =>
                  commit(entity, col.key, e.currentTarget.textContent ?? "")
                }
                className="block min-w-[60px] cursor-text font-mono text-xs outline-none focus:ring-2 focus:ring-primary/20"
              >
                {value !== 0 ? value : ""}
              </span>
            )}
          </td>
        ))}
        <td className="bg-info-soft px-2 py-1 text-right">
          {fmtCell(cashTotal, false)}
        </td>
        {cells.slice(7, 11).map(({ col, value }) => (
          <td
            key={col.key}
            className="bg-danger-soft/30 px-2 py-1 text-right"
          >
            {isTotal ? (
              fmtCell(value, col.payable)
            ) : (
              <span
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) =>
                  commit(entity, col.key, e.currentTarget.textContent ?? "")
                }
                className="block min-w-[60px] cursor-text font-mono text-xs outline-none focus:ring-2 focus:ring-primary/20"
              >
                {Math.abs(value) !== 0 ? Math.abs(value) : ""}
              </span>
            )}
          </td>
        ))}
        <td className="bg-danger-soft px-2 py-1 text-right">
          {fmtCell(totalPayables, true)}
        </td>
        <td className="px-2 py-1 text-right">
          {isTotal ? (
            fmtCell(stripe, false)
          ) : (
            <span
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) =>
                commit(entity, "stripe_pp", e.currentTarget.textContent ?? "")
              }
              className="block min-w-[60px] cursor-text font-mono text-xs outline-none focus:ring-2 focus:ring-primary/20"
            >
              {stripe !== 0 ? stripe : ""}
            </span>
          )}
        </td>
        <td className="bg-info-soft px-2 py-1 text-right">
          <span
            className={cn(
              "font-mono text-xs font-bold",
              cashBal >= 0 ? "text-success" : "text-danger",
            )}
          >
            {cashBal !== 0
              ? cashBal < 0
                ? `(${fmt(Math.abs(cashBal))})`
                : fmt(cashBal)
              : ""}
          </span>
        </td>
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
      <table className="w-full text-xs">
        <thead className="bg-primary text-primary-foreground">
          <tr>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider">
              Entity
            </th>
            {COLUMNS.slice(0, 7).map((c) => (
              <th
                key={c.key}
                className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider"
              >
                {c.label}
              </th>
            ))}
            <th className="bg-info px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">
              Cash Total
            </th>
            {COLUMNS.slice(7, 11).map((c) => (
              <th
                key={c.key}
                className="bg-danger px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider"
              >
                {c.label}
              </th>
            ))}
            <th className="bg-danger px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">
              Total Payables
            </th>
            <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">
              {COLUMNS[11].label}
            </th>
            <th className="bg-info px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider">
              Cash Bal (3 days)
            </th>
          </tr>
        </thead>
        <tbody>
          {ENTITIES.map((e) => rowFor(e, false))}
          {rowFor("Total", true)}
        </tbody>
      </table>
    </div>
  );
}
