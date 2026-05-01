import { PageShell } from "@/components/shell/PageShell";
import { Stat } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/server";
import { listOpenInvoices } from "@/lib/queries/invoices";
import { fmt } from "@/lib/format";
import { ApClient } from "./ApClient";

export const dynamic = "force-dynamic";

export default async function ApPage() {
  const supabase = await createClient();
  const open = await listOpenInvoices(supabase);
  const today = new Date().toISOString().slice(0, 10);
  const inSevenDays = new Date(Date.now() + 7 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  function remaining(i: (typeof open)[number]): number {
    return Number(i.amount) - Number(i.amount_paid ?? 0);
  }

  const total = open.reduce((s, i) => s + remaining(i), 0);
  const overdue = open.filter((i) => i.due_date < today);
  const overdueTotal = overdue.reduce((s, i) => s + remaining(i), 0);
  const dueThisWeek = open.filter(
    (i) => i.due_date >= today && i.due_date <= inSevenDays,
  );
  const dueThisWeekTotal = dueThisWeek.reduce((s, i) => s + remaining(i), 0);

  // Average days outstanding
  const avgDays =
    open.length === 0
      ? 0
      : Math.round(
          open.reduce(
            (s, i) =>
              s +
              (new Date(today).getTime() - new Date(i.invoice_date).getTime()) /
                (24 * 3600 * 1000),
            0,
          ) / open.length,
        );

  return (
    <PageShell
      page="ap"
      title="AP / Payables"
      subtitle="Bills due and payment schedule"
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

      <ApClient invoices={open} today={today} />
    </PageShell>
  );
}
