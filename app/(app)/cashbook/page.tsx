import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { getLatestSnapshots } from "@/lib/queries/cashbook";
import { CashbookClient } from "./CashbookClient";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function defaultMonthRange(): { startDate: string; endDate: string; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return {
    startDate: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`,
    endDate: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`,
    label: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`,
  };
}

function monthToRange(period: string): { startDate: string; endDate: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 0));
  return {
    startDate: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`,
    endDate: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function CashbookPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const def = defaultMonthRange();

  const periodParam = typeof sp.period === "string" ? sp.period : undefined;
  const fromParam = typeof sp.from === "string" ? sp.from : undefined;
  const toParam = typeof sp.to === "string" ? sp.to : undefined;

  let startDate = def.startDate;
  let endDate = def.endDate;
  let mode: "month" | "range" = "month";
  let monthLabel = def.label;

  if (fromParam && toParam && ISO_DATE.test(fromParam) && ISO_DATE.test(toParam) && fromParam <= toParam) {
    startDate = fromParam;
    endDate = toParam;
    mode = "range";
    monthLabel = "";
  } else if (periodParam) {
    const range = monthToRange(periodParam);
    if (range) {
      startDate = range.startDate;
      endDate = range.endDate;
      monthLabel = periodParam;
    }
  }

  const supabase = createDataClient();
  const snapshots = await getLatestSnapshots(supabase, { startDate, endDate });

  const subtitle = snapshots.paymentMethod
    ? `Synced ${new Date(snapshots.paymentMethod.fetched_at).toLocaleString()}`
    : "Not yet synced from Admin API";

  return (
    <PageShell page="cashbook" title="Cashbook" subtitle={subtitle}>
      <CashbookClient
        startDate={startDate}
        endDate={endDate}
        mode={mode}
        monthLabel={monthLabel}
        snapshots={snapshots}
      />
    </PageShell>
  );
}
