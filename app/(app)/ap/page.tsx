import { PageShell } from "@/components/shell/PageShell";
import { Stat } from "@/components/ui/Card";
import { createDataClient } from "@/lib/supabase/data";
import { listOpenApItems } from "@/lib/queries/ap";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { fmt } from "@/lib/format";
import { ApClient } from "./ApClient";

export const dynamic = "force-dynamic";

export default async function ApPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const entity = entityFilterFromSearchParams(sp);

  const supabase = createDataClient();
  const items = await listOpenApItems(supabase, { entity });

  const today = new Date().toISOString().slice(0, 10);
  const inSevenDays = new Date(Date.now() + 7 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  const overdue = items.filter((i) => i.due_date < today);
  const overdueTotal = overdue.reduce((s, i) => s + Number(i.amount), 0);
  const dueThisWeek = items.filter(
    (i) => i.due_date >= today && i.due_date <= inSevenDays,
  );
  const dueThisWeekTotal = dueThisWeek.reduce(
    (s, i) => s + Number(i.amount),
    0,
  );

  // Average days outstanding (days since invoice_date, fallback to today)
  const avgDays =
    items.length === 0
      ? 0
      : Math.round(
          items.reduce((s, i) => {
            const ref = i.invoice_date ?? today;
            return (
              s +
              (new Date(today).getTime() - new Date(ref).getTime()) /
                (24 * 3600 * 1000)
            );
          }, 0) / items.length,
        );

  // Aging buckets — mirrors legacy/app.js agingBucket() logic
  const buckets = aggregateBuckets(items, today);

  return (
    <PageShell
      page="ap"
      title="AP / Payables"
      subtitle={`Bills due and payment schedule · ${entity === "all" ? "All entities" : entity}`}
    >
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total payable" value={fmt(total)} />
        <Stat
          label="Overdue"
          value={fmt(overdueTotal)}
          delta={`${overdue.length} ${overdue.length === 1 ? "bill" : "bills"}`}
          tone={overdue.length > 0 ? "negative" : "default"}
        />
        <Stat
          label="Due this week"
          value={fmt(dueThisWeekTotal)}
          delta={`${dueThisWeek.length} ${dueThisWeek.length === 1 ? "bill" : "bills"}`}
          tone={dueThisWeek.length > 0 ? "warning" : "default"}
        />
        <Stat label="Avg days outstanding" value={`${avgDays}d`} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {buckets.map((b) => (
          <div
            key={b.key}
            className="rounded-xl border border-border bg-surface p-3 shadow-card"
          >
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
              {b.label}
            </div>
            <div className="mt-1 font-mono text-lg font-semibold text-foreground">
              {fmt(b.total)}
            </div>
            <div className="text-[11px] text-muted">
              {b.count} invoice{b.count === 1 ? "" : "s"}
            </div>
          </div>
        ))}
      </div>

      <ApClient items={items} today={today} />
    </PageShell>
  );
}

function aggingBucketKey(dueDate: string, today: string): string {
  const days = Math.floor(
    (new Date(today).getTime() - new Date(dueDate).getTime()) / 86400000,
  );
  if (days < 0) return "current";
  if (days <= 30) return "low";
  if (days <= 60) return "medium";
  if (days <= 90) return "high";
  return "critical";
}

function aggregateBuckets(
  items: ReadonlyArray<{ due_date: string; amount: number }>,
  today: string,
): Array<{ key: string; label: string; count: number; total: number }> {
  const defs = [
    { key: "current", label: "Current" },
    { key: "low", label: "1–30 Days" },
    { key: "medium", label: "31–60 Days" },
    { key: "high", label: "61–90 Days" },
    { key: "critical", label: "90+ Days" },
  ];
  const map = new Map(defs.map((d) => [d.key, { ...d, count: 0, total: 0 }]));
  for (const it of items) {
    const k = aggingBucketKey(it.due_date, today);
    const b = map.get(k);
    if (!b) continue;
    b.count += 1;
    b.total += Number(it.amount);
  }
  return defs.map((d) => map.get(d.key)!);
}
