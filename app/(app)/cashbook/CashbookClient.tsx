"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { fmt } from "@/lib/format";
import {
  refreshCashbookSnapshot,
  generateCashbookJournals,
  deleteAdminApiTransactions,
} from "@/actions/cashbook";
import type { CashbookSnapshotPair } from "@/lib/queries/cashbook";
import type {
  PaymentMethodReport,
  SalesSummaryReport,
  CompanyPaymentRow,
} from "@/lib/admin-api/schemas";
import { apiCompanyToEntityCode } from "@/lib/admin-api/entity-mapping";

type Props = {
  startDate: string;
  endDate: string;
  mode: "month" | "range";
  monthLabel: string;
  snapshots: CashbookSnapshotPair;
};

export function CashbookClient({
  startDate,
  endDate,
  mode,
  monthLabel,
  snapshots,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [isGenerating, startGenerating] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [tabMode, setTabMode] = useState<"month" | "range">(mode);
  const [period, setPeriod] = useState(monthLabel || currentMonth());
  const [from, setFrom] = useState(startDate);
  const [to, setTo] = useState(endDate);

  function applyPeriod() {
    if (tabMode === "month") {
      router.push(`/cashbook?period=${encodeURIComponent(period)}`);
    } else {
      router.push(`/cashbook?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    }
  }

  function refresh() {
    startTransition(async () => {
      try {
        await refreshCashbookSnapshot({ startDate, endDate });
        toast.push("Cashbook synced from Admin API", "success");
        router.refresh();
      } catch (e) {
        toast.push(
          (e as Error).message || "Failed to sync from Admin API",
          "error",
        );
      }
    });
  }

  function deleteAdminApi() {
    const ok = window.confirm(
      "Delete ALL Admin API transactions (transactions + raw_transactions)?\n\n" +
        "Snapshots in cashbook_snapshots are kept — you can re-fetch later.",
    );
    if (!ok) return;
    startDeleting(async () => {
      try {
        const r = await deleteAdminApiTransactions();
        toast.push(
          `Deleted ${r.transactionsDeleted} ledger row${r.transactionsDeleted === 1 ? "" : "s"} and ${r.rawTransactionsDeleted} raw row${r.rawTransactionsDeleted === 1 ? "" : "s"}.`,
          "success",
        );
        router.refresh();
      } catch (e) {
        toast.push(
          (e as Error).message || "Failed to delete Admin API transactions",
          "error",
        );
      }
    });
  }

  function generateJournals() {
    startGenerating(async () => {
      try {
        const r = await generateCashbookJournals({ startDate, endDate });
        const skippedNote =
          r.skippedCompanyIds.length > 0
            ? ` (skipped ${r.skippedCompanyIds.length} unmapped company)`
            : "";
        toast.push(
          `Created ${r.createdCount} draft journal entr${r.createdCount === 1 ? "y" : "ies"}${skippedNote}. Review on Journals.`,
          "success",
        );
        router.refresh();
      } catch (e) {
        toast.push(
          (e as Error).message || "Failed to generate journals",
          "error",
        );
      }
    });
  }

  const pm = snapshots.paymentMethod?.payload as PaymentMethodReport | null;
  // sales-summary payload is either the new wrapper {aggregate, byCompany}
  // or a legacy raw SalesSummaryReport. Normalize at read time.
  const ssRaw = snapshots.salesSummary?.payload as
    | { aggregate: SalesSummaryReport; byCompany: Record<string, SalesSummaryReport> }
    | SalesSummaryReport
    | null
    | undefined;
  const ss: SalesSummaryReport | null = ssRaw
    ? "aggregate" in ssRaw
      ? ssRaw.aggregate
      : ssRaw
    : null;
  const ssByCompany: Record<string, SalesSummaryReport> =
    ssRaw && "byCompany" in ssRaw ? ssRaw.byCompany : {};

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTabMode("month")}
              className={tabBtn(tabMode === "month")}
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => setTabMode("range")}
              className={tabBtn(tabMode === "range")}
            >
              Custom range
            </button>
          </div>

          {tabMode === "month" ? (
            <label className="flex flex-col text-[11px] text-muted">
              Period
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="mt-1 h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
              />
            </label>
          ) : (
            <>
              <label className="flex flex-col text-[11px] text-muted">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex flex-col text-[11px] text-muted">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="mt-1 h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
                />
              </label>
            </>
          )}

          <Button variant="outline" size="md" onClick={applyPeriod}>
            Apply
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-muted">
              {startDate} → {endDate}
            </span>
            <Button onClick={refresh} disabled={isPending || isGenerating}>
              {isPending ? "Syncing…" : "Refresh from Admin API"}
            </Button>
            <Button
              variant="outline"
              onClick={generateJournals}
              disabled={isPending || isGenerating || isDeleting || (!pm && !ss)}
              title={!pm && !ss ? "Refresh first" : "Create draft journal entries from this snapshot"}
            >
              {isGenerating ? "Generating…" : "Generate draft journals"}
            </Button>
            <Button
              variant="outline"
              onClick={deleteAdminApi}
              disabled={isPending || isGenerating || isDeleting}
              title="Delete all Admin API transactions and raw rows"
            >
              {isDeleting ? "Deleting…" : "Delete Admin API txns"}
            </Button>
          </div>
        </div>
      </Card>

      {!pm && !ss ? (
        <Card className="p-8 text-center text-sm text-muted">
          No snapshot for this range yet. Click <strong className="text-foreground">Refresh from Admin API</strong> to fetch.
        </Card>
      ) : (
        <PaymentMethodTabs pm={pm} ss={ss} ssByCompany={ssByCompany} />
      )}
    </div>
  );
}

function PaymentMethodTabs({
  pm,
  ss,
  ssByCompany,
}: {
  pm: PaymentMethodReport | null;
  ss: SalesSummaryReport | null;
  ssByCompany: Record<string, SalesSummaryReport>;
}) {
  // ALL tab plus one tab per company that appears in this snapshot. The
  // Admin API only returns ~5 companies (KP, LP, SWAG, BP, WBP), so tabs
  // reflect what's actually in the data, not the full WB entity roster.
  const companies = pm?.totals.companies ?? [];
  const [selected, setSelected] = useState<number | "ALL">("ALL");

  // If the active tab disappears after a refresh (entity dropped out of
  // the range), fall back to ALL.
  const activeCompany =
    selected === "ALL" ? null : companies.find((c) => c.company_id === selected) ?? null;
  const effective: number | "ALL" =
    selected !== "ALL" && !activeCompany ? "ALL" : selected;

  return (
    <div className="space-y-5">
      {pm && companies.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <EntityTabButton
            label="ALL"
            active={effective === "ALL"}
            onClick={() => setSelected("ALL")}
          />
          {companies.map((c) => {
            const code = apiCompanyToEntityCode(c.company_id);
            return (
              <EntityTabButton
                key={c.company_id}
                label={code ?? c.company_name}
                active={effective === c.company_id}
                onClick={() => setSelected(c.company_id)}
              />
            );
          })}
        </div>
      )}

      {pm && effective === "ALL" && <PaymentMethodPanel report={pm} />}
      {pm && effective !== "ALL" && activeCompany && (
        <PaymentMethodEntityPanel report={pm} company={activeCompany} />
      )}

      {ss && effective === "ALL" && <SalesSummaryPanel report={ss} />}
      {effective !== "ALL" && (() => {
        const perEntity = ssByCompany[String(effective)];
        if (perEntity) {
          return <SalesSummaryPanel report={perEntity} entityScoped />;
        }
        // Snapshot was taken before per-entity sales-summary was wired up.
        return (
          <Card className="p-4 text-[11px] text-muted">
            COGS &amp; ad-spend for this entity isn&apos;t in the current snapshot. Click{" "}
            <strong className="text-foreground">Refresh from Admin API</strong> to fetch per-entity figures.
          </Card>
        );
      })()}
    </div>
  );
}

function EntityTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-md px-2.5 text-[11px] font-medium transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-surface text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function PaymentMethodEntityPanel({
  report,
  company,
}: {
  report: PaymentMethodReport;
  company: CompanyPaymentRow;
}) {
  const stripe = (company.cc ?? 0) + (company.gpay ?? 0) + (company.klarna ?? 0);
  const stripeRefunds =
    (company.refunds_cc ?? 0) +
    (company.refunds_gpay ?? 0) +
    (company.refunds_klarna ?? 0);

  const entityCode = apiCompanyToEntityCode(company.company_id);

  // Per-day view for this one company. report.rows is per-day; each row's
  // `companies` may omit days with no activity, so we filter to this id.
  type DayRow = { date: string; row: CompanyPaymentRow };
  const days: DayRow[] = [];
  for (const r of report.rows) {
    const match = r.companies.find((c) => c.company_id === company.company_id);
    if (match) days.push({ date: r.date, row: match });
  }

  return (
    <Card className="p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">{company.company_name}</h2>
        {entityCode && (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
            {entityCode}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-muted">
        Payment-method totals · {report.start_date} → {report.end_date}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Stripe (CC + GPay + Klarna)" value={stripe} />
        <KpiTile label="PayPal" value={company.paypal} />
        <KpiTile label="Check / Wire" value={company.check_wire} />
        <KpiTile label="Gross sales" value={company.gross_sales} highlight />
        <KpiTile label="Stripe refunds" value={stripeRefunds} negative />
        <KpiTile label="PayPal refunds" value={company.refunds_paypal} negative />
        <KpiTile label="Total refunds" value={company.refunds} negative />
        <KpiTile label="Net sales" value={company.net_sales} highlight />
      </div>

      {days.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Daily breakdown
          </h3>
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3 text-right">Stripe</th>
                <th className="py-2 pr-3 text-right">PayPal</th>
                <th className="py-2 pr-3 text-right">Check/Wire</th>
                <th className="py-2 pr-3 text-right">Gross</th>
                <th className="py-2 pr-3 text-right">Refunds</th>
                <th className="py-2 pr-3 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {days.map(({ date, row }) => {
                const dStripe = (row.cc ?? 0) + (row.gpay ?? 0) + (row.klarna ?? 0);
                return (
                  <tr key={date} className="border-t border-border/60">
                    <td className="py-2 pr-3 font-mono text-[11px]">{date}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(dStripe)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(row.paypal)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(row.check_wire)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(row.gross_sales)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-danger">
                      {fmt(row.refunds)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmt(row.net_sales)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PaymentMethodPanel({ report }: { report: PaymentMethodReport }) {
  const t = report.totals.total;
  const stripe = (t.cc ?? 0) + (t.gpay ?? 0) + (t.klarna ?? 0);
  const stripeRefunds =
    (t.refunds_cc ?? 0) + (t.refunds_gpay ?? 0) + (t.refunds_klarna ?? 0);

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">Gross revenue & returns</h2>
      <p className="mt-0.5 text-[11px] text-muted">
        Source: payment-method report (group by order date)
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Stripe (CC + GPay + Klarna)" value={stripe} />
        <KpiTile label="PayPal" value={t.paypal} />
        <KpiTile label="Check / Wire" value={t.check_wire} />
        <KpiTile label="Gross sales" value={t.gross_sales} highlight />
        <KpiTile label="Stripe refunds" value={stripeRefunds} negative />
        <KpiTile label="PayPal refunds" value={t.refunds_paypal} negative />
        <KpiTile label="Total refunds" value={t.refunds} negative />
        <KpiTile label="Net sales" value={t.net_sales} highlight />
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2 pr-3">Entity</th>
              <th className="py-2 pr-3">Company (API)</th>
              <th className="py-2 pr-3 text-right">Stripe</th>
              <th className="py-2 pr-3 text-right">PayPal</th>
              <th className="py-2 pr-3 text-right">Check/Wire</th>
              <th className="py-2 pr-3 text-right">Gross</th>
              <th className="py-2 pr-3 text-right">Refunds</th>
              <th className="py-2 pr-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {report.totals.companies.map((c) => {
              const cStripe = (c.cc ?? 0) + (c.gpay ?? 0) + (c.klarna ?? 0);
              const entityCode = apiCompanyToEntityCode(c.company_id);
              return (
                <tr key={c.company_id} className="border-t border-border/60">
                  <td className="py-2 pr-3">
                    {entityCode ? (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                        {entityCode}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-medium text-foreground">{c.company_name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(cStripe)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(c.paypal)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(c.check_wire)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(c.gross_sales)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-danger">{fmt(c.refunds)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(c.net_sales)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SalesSummaryPanel({
  report,
  entityScoped,
}: {
  report: SalesSummaryReport;
  entityScoped?: boolean;
}) {
  const t = report.totals;
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">COGS & ad spend</h2>
      <p className="mt-0.5 text-[11px] text-muted">
        {entityScoped
          ? "Source: sales-summary/live (companyIds filter — channel split unavailable)"
          : "Source: sales-summary/live (segment=all)"}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="COGS (WB + SP)" value={t.cogs} />
        <KpiTile label="Google Ads" value={t.ads_cost_google} />
        <KpiTile label="Meta Ads" value={t.ads_cost_meta} />
        <KpiTile label="Bing Ads" value={t.ads_cost_bing} />
        <KpiTile label="ASI Ads" value={t.ads_cost_asi} />
        <KpiTile label="Total ad spend" value={t.ads_cost_total} highlight />
        <KpiTile label="Orders" value={t.orders_count} isCount />
        <KpiTile
          label="ROAS"
          value={typeof t.roas === "number" ? t.roas : null}
          isRatio
        />
      </div>
    </Card>
  );
}

function KpiTile({
  label,
  value,
  highlight,
  negative,
  isCount,
  isRatio,
}: {
  label: string;
  value: number | null | undefined;
  highlight?: boolean;
  negative?: boolean;
  isCount?: boolean;
  isRatio?: boolean;
}) {
  const display =
    value == null
      ? "—"
      : isCount
        ? new Intl.NumberFormat("en-US").format(value)
        : isRatio
          ? value.toFixed(2) + "x"
          : fmt(value);
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          highlight ? "text-primary" : negative ? "text-danger" : "text-foreground"
        }`}
      >
        {display}
      </div>
    </div>
  );
}

function tabBtn(active: boolean): string {
  return `h-8 rounded-md px-3 text-xs font-medium transition ${
    active
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-surface text-muted hover:text-foreground"
  }`;
}

function currentMonth(): string {
  const d = new Date();
  const m = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}-${m < 10 ? `0${m}` : m}`;
}
