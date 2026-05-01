# Next.js Migration Plan — WB Brands Finance OS

## Context

Current build is a single-page vanilla JS app: `index.html` + `styles.css` + `app.js` (~7,400 lines, single global `app.*` object) + two Vercel serverless proxies, talking to Supabase. It works, but the architecture forces every security control to live on the client, and the 7,400-line file is becoming unmaintainable (20 pages, 98 `innerHTML` call sites, hand-built routing).

The migration's two goals:

1. **Security by architecture.** Move Supabase access server-side so the anon key never ships to a browser, replace the plaintext password gate with real auth, kill the open `/api/supabase` proxy, and let JSX auto-escaping erase the XSS surface.
2. **Sustainable codebase.** Componentized React/TypeScript, typed Supabase client, real routing, real forms, real tests.

This plan addresses 7 of the 10 items in [securing-finance-os](../../.claude/plans/i-want-to-secure-eager-eclipse.md) as side effects of the rewrite. The remaining 3 (RLS policies, audit log, MFA) still need explicit work and are scheduled in the phases below.

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router)** | Server Components + Server Actions = no client-side DB credentials. |
| Language | **TypeScript (strict)** | A rewrite is the only cheap moment to add types; ledger code is exactly where types pay off. |
| Auth | **Supabase Auth + `@supabase/ssr`** | HttpOnly cookie sessions, server-side JWT verification, free MFA support. |
| Data | **Supabase JS client** (server + browser variants) | No ORM yet — RLS is the real schema-of-record. Add Drizzle later only if raw SQL piles up. |
| Mutations | **Server Actions** | Replace the `/api/supabase` proxy entirely; one less attack surface. |
| Styling | **Keep `styles.css` as `app/globals.css`** initially | 59 KB of well-tuned styles; do not rewrite into Tailwind in the same project as the framework migration. Migrate to CSS Modules opportunistically per-component. |
| Forms / validation | **Zod** + Server Action + native `<form>` | No form library needed for MVP. |
| Tables | **TanStack Table v8** (headless) | Replaces all the hand-built sort/filter/pagination logic. |
| AI | **Anthropic SDK in Route Handler** (`app/api/ai/route.ts`) | Key never leaves the server; per-user rate limit. |
| Rate limit | **Upstash Redis + `@upstash/ratelimit`** | Works on Vercel Edge; cheap; covers `/api/ai` and login. |
| Tests | **Playwright** (E2E) + **Vitest** (utils) | E2E is the only way to be sure a finance app is correct. |
| Deploy | **New Vercel project on a staging subdomain** | Run new and old in parallel for the cutover. Do **not** rewrite in place. |

Decisions deferred but flagged: Tailwind migration (later), Drizzle (only if needed), realtime updates (only if the team wants it).

---

## Target file layout

```
app/
  (auth)/
    login/page.tsx
    auth/callback/route.ts
  (app)/
    layout.tsx                 # sidebar + topbar + entity switcher (Server Component)
    dashboard/page.tsx
    inbox/page.tsx             # Bank Transactions
    cc-inbox/page.tsx
    ledger/page.tsx
    journals/page.tsx
    journals/[id]/page.tsx
    reconcile/page.tsx
    vendors/page.tsx
    invoices/page.tsx
    ap/page.tsx
    pnl/page.tsx
    balance/page.tsx
    cashflow/page.tsx
    forecast/page.tsx
    cash-balances/page.tsx
    ratios/page.tsx
    cfnotes/page.tsx
    sales/page.tsx
    productmix/page.tsx
    coa/page.tsx
    banks/page.tsx
  api/
    ai/route.ts                # Anthropic proxy (replaces direct browser call)
  layout.tsx                   # <html>, fonts, globals.css
  page.tsx                     # → redirect to /dashboard or /login
components/
  Sidebar.tsx, Topbar.tsx, EntitySwitcher.tsx
  data-tables/...              # TransactionsTable, JournalsTable, LedgerTable...
  drawers/...                  # JournalEntryDrawer, TxnSplitDrawer...
  ui/...                       # Button, Modal, Toast — primitives
lib/
  supabase/
    server.ts                  # createServerClient (cookies)
    client.ts                  # createBrowserClient
    middleware.ts              # session refresh helper
    types.ts                   # generated via `supabase gen types`
  entities.ts                  # ENTITY_GROUPS, ALL_ENTITY_CODES, detectEntityFromBankAccount
  format.ts                    # money, date, pct
  audit.ts                     # writeAuditLog(actor, op, before, after)
  rate-limit.ts                # Upstash wrapper
  ai/anthropic.ts
actions/                       # Server Actions, one file per domain
  transactions.ts, journals.ts, vendors.ts, invoices.ts, ledger.ts...
middleware.ts                  # auth gate + edge rate limit
styles/
  globals.css                  # = current styles.css
supabase/
  migrations/
    0001_baseline_schema.sql   # dumped from current Supabase
    0002_enable_rls.sql
    0003_user_roles.sql
    0004_audit_log.sql
.env.local.example
next.config.ts                 # security headers
package.json, tsconfig.json
```

---

## Phased schedule (one focused engineer)

Estimates assume ~6 hrs/day of focused work and that the existing Supabase data stays in place. Add ~30% buffer if interrupted.

### Phase 0 — Foundation (1–2 days)
- New Next.js 15 project at repo root in a `web/` subdir, or new repo `wb-finance-os-next`.
- Install: `next`, `react`, `typescript`, `@supabase/ssr`, `@supabase/supabase-js`, `@anthropic-ai/sdk`, `zod`, `@tanstack/react-table`, `@upstash/ratelimit`.
- Copy `styles.css` → `app/globals.css`; keep selectors identical so markup ports cleanly.
- Wire fonts via `next/font` (DM Sans + DM Mono per current README).
- `.env.local.example` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (server-only), `ANTHROPIC_API_KEY`, `UPSTASH_*`.
- Empty middleware + Supabase client helpers compile + deploy to staging Vercel project.

**Done when:** staging URL serves a blank Next.js page with global styles loaded.

### Phase 1 — Auth + Shell (2–3 days)
- Run `supabase gen types typescript` against the live DB → `lib/supabase/types.ts`.
- Implement `lib/supabase/{server,client,middleware}.ts` per `@supabase/ssr` cookie pattern.
- `middleware.ts` refreshes the session and 302s anonymous users from `(app)/*` to `/login`.
- `/login/page.tsx` — email + password form (Server Action). No magic link in MVP.
- Create `profiles` table (`user_id` PK → `auth.users`, `role enum('coo','bookkeeper','cpa','admin')`, `email`, `display_name`).
- Seed the four current users via Supabase dashboard. **Once verified, delete the `ROLES` plaintext block from `app.js` and rotate access codes.**
- `(app)/layout.tsx` — server-fetched profile + entity list; renders `<Sidebar>`, `<Topbar>`, `<EntitySwitcher>` as Client Components when interactive, Server Components when not.
- Sidebar navigation gated server-side: server reads `profile.role`, hides items the user cannot use, and redirects on direct URL access.

**Done when:** logging in lands on `/dashboard` (still empty), wrong password fails, role-based redirect works, and the page chrome matches the current design pixel-for-pixel.

### Phase 2 — Database hardening (2–3 days)

Run in parallel with later phases — security cannot wait for the UI to finish.

- `supabase db dump` → `supabase/migrations/0001_baseline_schema.sql` (committed for source of truth).
- `0002_enable_rls.sql`: `alter table … enable row level security;` for every table. Default-deny.
- `0003_user_roles.sql`: `profiles` table + `user_entities` join (per-user entity scoping).
- Policies, by table:
  - `transactions`, `journal_entries`, `journal_lines`, `ledger_*`, `vendors`, `invoices`, `accounts`, `entities`:
    - **Select** for `coo`, `cpa` (all entities), `bookkeeper` and `admin` (all entities).
    - **Insert/Update/Delete**: `bookkeeper` + `admin` only, scoped by `user_entities`.
    - `cpa` is read-only on financial tables.
  - `cfnotes`: `coo`, `cpa`, `admin` read/write.
- `0004_audit_log.sql`:
  - `audit_log(id, actor_user_id, table_name, row_id, op, before jsonb, after jsonb, at timestamptz default now())`.
  - Append-only RLS (`with check (false)` on update/delete; insert via `security definer` trigger).
  - Triggers on every mutating table that capture `OLD`/`NEW` to JSONB.
- Verify: `supabase test db` script that signs in as each role and confirms allowed/denied operations.

**Done when:** as the anon user, every read returns 0 rows; as each role, only the right rows are accessible; every mutation appears in `audit_log`.

### Phase 3 — Read-only pages (3–5 days)

Port pages where the user only consumes data. Lower risk; establishes the patterns reused later.

Order:
1. **Dashboard** — KPI cards. Server Component fetches all metrics in parallel (`Promise.all`), passes to a Client Component for the period-selector interactivity only.
2. **Cash Balances** — table + entity totals.
3. **P&L**, **Balance Sheet**, **Cash Flow** — three views over the same period+entity filter; share a `<FinancialStatement>` component.
4. **Ratios & KPIs**, **Sales Metrics**, **Product Mix**, **Forecast** — all read-only chart/table pages.
5. **Chart of Accounts** — read-only list (admin can edit later in Phase 5).

Pattern: each page is a `page.tsx` (Server Component) that:
- Reads `searchParams` (entity, period).
- Calls a server data function in `lib/queries/<domain>.ts`.
- Renders a Client Component for any in-page interactivity.

**Done when:** all 9 read-only pages render with live Supabase data, identical look to the current app, and every query goes through the typed server client.

### Phase 4 — Write pages (5–8 days)

The high-stakes pages. Each gets Server Actions + optimistic UI + audit-log verification.

Order (least → most complex):
1. **Vendors** — CRUD on a small table; good pattern test.
2. **Invoices** — CRUD + status changes.
3. **Bank Connections / Banks** — CRUD.
4. **CFO Notes** — markdown CRUD.
5. **Ledger** — read-heavy with inline amount edits (exists in current commits).
6. **Reconciliation** — match transactions to bank statement rows.
7. **AP / Payables** — bill schedule + payments.
8. **Bank Transactions Inbox** — confirm/edit/split, status changes, reTag flow. Largest single page; budget 2 days alone.
9. **Credit Card Inbox** — same shape as Bank Inbox but with the entity-dropdown logic in [recent commits](../seed.sql).
10. **Journal Entries** — create, inline edit, delete, posting flow. Touches the most tables; do last.

Each Server Action:
- Validates input with Zod.
- Calls Supabase via the cookie-bound server client (RLS does authorization).
- Re-validates the cache for affected paths.
- Surfaces structured errors back to the form.

**Done when:** every workflow the bookkeeper performs today works through the new app, and every write produces an audit-log row.

### Phase 5 — AI Advisor + admin tooling (1–2 days)
- `app/api/ai/route.ts`: receives chat history, builds the same financial context server-side (port `buildFinancialContext`), calls Anthropic with the **server-side** key, streams response back.
- Per-user rate limit (Upstash): 20 req/min, 200 req/day.
- Drop the `localStorage.wbAiKey` UI and the connect-key flow.
- Admin page (`/admin/users`): list profiles, change roles, invite new users via Supabase Auth admin API. Admin-only via RLS + middleware.

**Done when:** AI panel works for any logged-in COO/admin without anyone touching an API key, and admin can manage users without leaving the app.

### Phase 6 — Hardening + cutover (2–3 days)
- `next.config.ts`: full security headers (CSP with `'self'` + Supabase + fonts host, HSTS, frame-ancestors none, etc.).
- Edge `middleware.ts`: rate-limit `/api/*` and `/login` per IP.
- Enable Supabase Auth MFA; require it for `admin` role.
- Set Supabase JWT expiry to 60 min, enable refresh-token rotation.
- Playwright suite covering: login, role-based redirect, vendor CRUD, journal entry create+edit+delete, bank inbox confirm-and-split, AI chat, audit-log presence.
- DNS cutover plan:
  1. Point staging URL at the new Vercel project for one week of internal use.
  2. Snapshot Supabase + run a regression checklist in staging.
  3. Swap the production domain to the new project; keep the old project deployable for instant rollback.
  4. After 7 days clean, archive `index.html` / `styles.css` / `app.js` into `legacy/` and delete the old Vercel project.

**Done when:** prod traffic is on Next.js, MFA is on for admin, headers grade A on Mozilla Observatory, Playwright is green in CI.

---

## Total estimate

**~3.5–5 weeks** of focused work for one engineer, ~6–8 weeks calendar with normal interruptions. The biggest single risk is Phase 4 (the Inbox + JE pages); if those lag, everything else holds.

---

## Decisions (locked)

1. **Repo strategy** — same repo, new branch `nextjs-migration`. Legacy files (`index.html`, `styles.css`, `app.js`, `api/`, `vercel.json`) move into `legacy/` for reference; Next.js project at repo root.
2. **Auth method** — Supabase email + password.
3. **Schema source of truth** — `supabase db dump` produces a committed baseline migration. **No RLS for now** (deferred): every authenticated user gets full data access via the anon key + cookie session; authorization is enforced in the app layer (middleware + page-level role checks). RLS will be added in a later phase.
4. **Entity scoping** — every authenticated user sees every entity (matches current behavior). The entity selector remains a UI filter, not a permission boundary.
5. **Tailwind** — added now, in Phase 0. Existing `styles.css` becomes `app/globals.css` and is preserved as-is for the layout/component classes the original design uses; new components use Tailwind. CSS variables (`--accent`, `--text`, etc.) are mirrored into `tailwind.config.ts` so both styles work side-by-side.

## Role-based access matrix (extracted from current code)

Authoritative source: `data-roles="…"` attributes in [legacy/index.html](../legacy/index.html) and the `_applyRole` function in [legacy/app.js](../legacy/app.js).

### Pages

| Page | coo | bookkeeper | cpa | admin |
|---|:-:|:-:|:-:|:-:|
| `dashboard` | ✓ |  |  | ✓ |
| `inbox` (Bank Transactions) |  | ✓ |  | ✓ |
| `cc-inbox` (Credit Card Txns) |  | ✓ |  | ✓ |
| `ledger` | ✓ | ✓ |  | ✓ |
| `journals` (Journal Entries) | ✓ | ✓ | ✓ | ✓ |
| `reconcile` | ✓ | ✓ |  | ✓ |
| `vendors` | ✓ | ✓ |  | ✓ |
| `invoices` | ✓ | ✓ |  | ✓ |
| `ap` (Payables) | ✓ |  | ✓ | ✓ |
| `pnl` (Profit & Loss) | ✓ |  | ✓ | ✓ |
| `balance` (Balance Sheet) | ✓ |  | ✓ | ✓ |
| `cashflow` | ✓ |  | ✓ | ✓ |
| `forecast` (Cash Forecast) | ✓ |  |  | ✓ |
| `cash-balances` | ✓ | ✓ | ✓ | ✓ |
| `ratios` (Ratios & KPIs) | ✓ |  | ✓ | ✓ |
| `cfnotes` (CFO Notes) | ✓ |  | ✓ | ✓ |
| `sales` (Sales Metrics) | ✓ |  |  | ✓ |
| `productmix` (Product Mix) | ✓ |  |  | ✓ |
| `coa` (Chart of Accounts) |  | ✓ | ✓ | ✓ |
| `banks` (Bank Connections) | ✓ |  |  | ✓ |
| `import` (modal) | ✓ | ✓ | ✓ | ✓ |

### Topbar / sidebar actions

| Element | coo | bookkeeper | cpa | admin |
|---|:-:|:-:|:-:|:-:|
| Sync (refreshAllSheets) | ✓ |  |  |  |
| `+ Add Transaction` btn |  | ✓ |  |  |
| `🗑 Clear All Data` btn | ✓ | ✓ |  | ✓ |
| AI Advisor panel | ✓ |  |  |  |
| Cash Runway dashboard card | ✓ |  |  |  |

### Default landing page

| Role | Lands on |
|---|---|
| coo | `dashboard` |
| bookkeeper | `inbox` |
| cpa | `pnl` |
| admin | `dashboard` |

This matrix is encoded once in `lib/auth/permissions.ts` and consumed by:
- `middleware.ts` — server-side route gate
- `app/(app)/layout.tsx` — sidebar nav filtering + default redirect
- per-page `<RequireRole>` server check
- per-component `<RoleGate>` wrapper for action buttons

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Schema drifts during the rewrite | Freeze schema changes after Phase 2 baseline, or commit every Studio change as a new migration. |
| Bookkeeper workflow breaks during cutover | Internal staging week with both apps live; keep the old Vercel project deployable for one week post-cutover. |
| RLS policy gaps allow over-broad access | Phase 2 verification script tests each role; Playwright tests assert "user X cannot see entity Y." |
| Anthropic key abuse | Rate limit + monthly cap + alert on spend in Vercel Analytics. |
| 7,400 lines of business logic gets ported wrong | Port one page at a time, each with a Playwright test that mirrors the existing manual workflow. Do not move on until the test passes. |

---

## Verification (project-level)

After cutover, the following must all be true:

1. `grep -RniE 'wb-(coo|books|cpa|admin)|eyJhbGciOi' app/ lib/ actions/` returns nothing.
2. `curl -I https://prod-host` shows CSP, HSTS, X-Frame-Options.
3. Logged-out direct fetch of any `(app)/*` page redirects to `/login`.
4. Logged-out direct fetch of any `app/api/*` returns 401.
5. As `cpa`, attempting an `update` on `transactions` returns RLS error.
6. Editing a journal entry creates an `audit_log` row with the correct `before`/`after` JSON.
7. Anthropic key is `undefined` in the browser; AI panel still works.
8. Inserting a vendor named `<img src=x onerror=alert(1)>` renders as literal text on every page.
9. Login form locks out after 5 failures within 5 minutes.
10. `admin` cannot log in without MFA.
