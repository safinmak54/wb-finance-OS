import "server-only";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { readServerEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canDoAction } from "@/lib/auth/permissions";
import { fetchReportData, totals } from "@/lib/queries/reports";
import { listOpenInvoices } from "@/lib/queries/invoices";
import { listCashBalances } from "@/lib/queries/cash";
import { fmt } from "@/lib/format";
import { periodFromSearchParams } from "@/lib/period";

export const runtime = "nodejs";

const RequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .max(20)
    .optional(),
  context: z
    .object({
      period: z.string().optional(),
      entity: z.string().optional(),
    })
    .optional(),
});

// Per-user in-memory rate limit (lost on cold start; sufficient for MVP).
const RATE_BUCKET = new Map<string, { count: number; resetAt: number }>();
const PER_MIN = 20;

function checkRateLimit(userId: string): { ok: boolean; resetIn: number } {
  const now = Date.now();
  const cur = RATE_BUCKET.get(userId);
  if (!cur || cur.resetAt < now) {
    RATE_BUCKET.set(userId, { count: 1, resetAt: now + 60_000 });
    return { ok: true, resetIn: 60 };
  }
  if (cur.count >= PER_MIN) {
    return { ok: false, resetIn: Math.ceil((cur.resetAt - now) / 1000) };
  }
  cur.count += 1;
  return { ok: true, resetIn: Math.ceil((cur.resetAt - now) / 1000) };
}

async function buildContext(opts: {
  period?: string;
  entity?: string;
}): Promise<string> {
  const supabase = await createClient();
  const period = periodFromSearchParams({ period: opts.period });
  const entity = (opts.entity ?? "all") as Parameters<typeof fetchReportData>[1]["entity"];

  const [report, openInvoices, cashRows] = await Promise.all([
    fetchReportData(supabase, {
      entity,
      from: period.from,
      to: period.to,
    }),
    listOpenInvoices(supabase),
    listCashBalances(supabase),
  ]);

  const t = totals(report.txns);
  const grossProfit = t.revenue - t.cogs;
  const netIncome = grossProfit - t.expense;

  const sec1Keys = ["tfb", "hunt", "vend_pay", "cc", "int_xfer", "google", "hunt_bal"];
  const payableKeys = ["cc_pay", "vend_pmts", "goog_pend", "fedex"];
  let cash = 0;
  let payables = 0;
  for (const r of cashRows) {
    if (sec1Keys.includes(r.col_key)) cash += Number(r.value ?? 0);
    else if (payableKeys.includes(r.col_key))
      payables += Math.abs(Number(r.value ?? 0));
  }

  const overdue = openInvoices.filter((i) => i.status === "overdue");
  const topVendors = [...openInvoices]
    .sort(
      (a, b) =>
        Number(b.amount) -
        Number(b.amount_paid ?? 0) -
        (Number(a.amount) - Number(a.amount_paid ?? 0)),
    )
    .slice(0, 5);

  return [
    `Period: ${period.label} (${period.from} → ${period.to})`,
    `Entity scope: ${opts.entity ?? "all"}`,
    `Revenue: ${fmt(t.revenue)}`,
    `COGS: ${fmt(t.cogs)}`,
    `Operating expenses: ${fmt(t.expense)}`,
    `Gross profit: ${fmt(grossProfit)}`,
    `Net income: ${fmt(netIncome)}`,
    `Cash position (latest manual): ${fmt(cash - payables)}`,
    `Open invoices: ${openInvoices.length} totaling ${fmt(openInvoices.reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid ?? 0), 0))}`,
    `Overdue: ${overdue.length} invoices`,
    `Top open balances: ${topVendors.map((i) => `${i.vendors?.name ?? "?"} ${fmt(Number(i.amount) - Number(i.amount_paid ?? 0))}`).join(", ")}`,
  ].join("\n");
}

const SYSTEM_PROMPT = `You are a financial thinking partner for WB Brands, a multi-entity holding company.
Be sharp and direct. 150 words max. Always end with 2-3 follow-up questions.
Use only the live financial context provided. If the user asks something the
context can't answer, say so plainly.`;

export async function POST(req: Request) {
  const me = await getCurrentProfile();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canDoAction(me.role, "ai-advisor")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rl = checkRateLimit(me.userId);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry in ${rl.resetIn}s.` },
      { status: 429 },
    );
  }

  let parsed;
  try {
    parsed = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const env = readServerEnv();
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 503 },
    );
  }

  const context = await buildContext({
    period: parsed.context?.period,
    entity: parsed.context?.entity,
  });

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const result = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: `${SYSTEM_PROMPT}\n\nLive context:\n${context}`,
      messages: [
        ...(parsed.history ?? []).map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: "user", content: parsed.message },
      ],
    });

    const text = result.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");

    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
