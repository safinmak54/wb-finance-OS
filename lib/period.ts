/**
 * Period resolver. Mirrors `state.globalPeriod` + `state.globalPeriodRange`
 * from legacy/app.js. URL-driven via `?period=…&from=…&to=…`.
 *
 * Supported keys:
 *   - "month"      → current month
 *   - "last-month" → previous month
 *   - "qtd"        → quarter to date
 *   - "ytd"        → year to date
 *   - "custom"     → use provided from/to
 *   - "YYYY-MM"    → that single month
 *
 * Default: year-to-date (covers sparse activity better than current-month).
 */

export type PeriodKey =
  | "month"
  | "last-month"
  | "qtd"
  | "ytd"
  | "custom"
  | string; // YYYY-MM

export type PeriodRange = {
  key: PeriodKey;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  label: string;
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function todayUtc(): { year: number; month: number; day: number } {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
}

export function resolvePeriod(input: {
  key?: string | null;
  from?: string | null;
  to?: string | null;
}): PeriodRange {
  const today = todayUtc();
  const key = (input.key ?? "ytd") as PeriodKey;

  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [yStr, mStr] = key.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    return {
      key,
      from: ymd(y, m, 1),
      to: ymd(y, m, lastDayOfMonth(y, m)),
      label: `${MONTH_NAMES[m - 1]} ${y}`,
    };
  }

  if (key === "custom") {
    const from = input.from ?? ymd(today.year, today.month, 1);
    const to = input.to ?? ymd(today.year, today.month, today.day);
    return { key, from, to, label: `${from} → ${to}` };
  }

  if (key === "last-month") {
    let y = today.year;
    let m = today.month - 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    return {
      key,
      from: ymd(y, m, 1),
      to: ymd(y, m, lastDayOfMonth(y, m)),
      label: `${MONTH_NAMES[m - 1]} ${y}`,
    };
  }

  if (key === "qtd") {
    const qStart = Math.floor((today.month - 1) / 3) * 3 + 1;
    return {
      key,
      from: ymd(today.year, qStart, 1),
      to: ymd(today.year, today.month, today.day),
      label: `QTD (${MONTH_NAMES[qStart - 1]} ${today.year})`,
    };
  }

  if (key === "ytd") {
    return {
      key,
      from: ymd(today.year, 1, 1),
      to: ymd(today.year, today.month, today.day),
      label: `YTD ${today.year}`,
    };
  }

  // Default: current month
  return {
    key: "month",
    from: ymd(today.year, today.month, 1),
    to: ymd(today.year, today.month, lastDayOfMonth(today.year, today.month)),
    label: `${MONTH_NAMES[today.month - 1]} ${today.year}`,
  };
}

/** Read `searchParams` (URL-style record) into a PeriodRange. */
export function periodFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): PeriodRange {
  return resolvePeriod({
    key: typeof sp.period === "string" ? sp.period : null,
    from: typeof sp.from === "string" ? sp.from : null,
    to: typeof sp.to === "string" ? sp.to : null,
  });
}

/** YYYY-MM string for a given date string (used for closed_periods lookups). */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** Subtract one month from a YYYY-MM-DD string. */
export function subtractMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Returns the prior period (same length, immediately before `range`). */
export function priorPeriod(range: PeriodRange): PeriodRange {
  const fromD = new Date(`${range.from}T00:00:00Z`);
  const toD = new Date(`${range.to}T00:00:00Z`);
  const lengthMs = toD.getTime() - fromD.getTime();
  const priorTo = new Date(fromD.getTime() - 24 * 3600 * 1000);
  const priorFrom = new Date(priorTo.getTime() - lengthMs);
  return {
    key: "custom",
    from: priorFrom.toISOString().slice(0, 10),
    to: priorTo.toISOString().slice(0, 10),
    label: `Prior period`,
  };
}
