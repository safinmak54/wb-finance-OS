/**
 * Money / date / percent formatting. Mirrors `fmt()` in legacy/app.js
 * (~line 7222) but with TypeScript and Intl-based formatting.
 */

const moneyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const moneyFmtCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateShort = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateNumeric = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "2-digit",
});

/** `$12,345` (no cents) — matches legacy default. Negatives are shown
 *  in parentheses, the accounting convention used throughout the app. */
export function fmt(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0";
  if (v < 0) return `(${moneyFmt.format(Math.abs(v))})`;
  return moneyFmt.format(v);
}

export function fmtCents(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0.00";
  if (v < 0) return `(${moneyFmtCents.format(Math.abs(v))})`;
  return moneyFmtCents.format(v);
}

export function fmtPct(
  n: number | null | undefined,
  digits = 1,
): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0%";
  return `${v.toFixed(digits)}%`;
}

/** `Mar 31, 2025` */
export function fmtDate(input: string | Date | null | undefined): string {
  if (!input) return "";
  const d = typeof input === "string" ? parseDate(input) : input;
  if (!d) return "";
  return dateShort.format(d);
}

/** `3/31/25` — denser format used in tables and chips. */
export function fmtDateShort(
  input: string | Date | null | undefined,
): string {
  if (!input) return "";
  const d = typeof input === "string" ? parseDate(input) : input;
  if (!d) return "";
  return dateNumeric.format(d);
}

/**
 * Coerce a YYYY-MM-DD or ISO timestamp to a local Date. Treats bare
 * date strings as midnight UTC to avoid timezone surprises in tables.
 */
export function parseDate(input: string): Date | null {
  if (!input) return null;
  // bare YYYY-MM-DD → treat as UTC midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(`${input}T00:00:00Z`);
  }
  const t = Date.parse(input);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Returns today as YYYY-MM-DD (UTC). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalize loose date strings to YYYY-MM-DD. Mirrors legacy
 * `normalizeDate()` (~line 555). Recognized: ISO, US m/d/yyyy,
 * d-MMM-yyyy, MMM d yyyy. Returns "" on failure.
 */
export function normalizeDate(input: string | null | undefined): string {
  if (!input) return "";
  const s = String(input).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // m/d/yyyy or m-d-yyyy
  const slash = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    const yyyy = y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Try Date.parse as a last resort
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);

  return "";
}
