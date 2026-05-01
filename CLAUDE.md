# WB Brands Finance OS

Multi-entity financial dashboard for WB Brands and subsidiaries.

## Stack (nextjs-migration branch)

- **Next.js 15** (App Router) + **React 19** + **TypeScript (strict)**
- **Tailwind CSS v4** (CSS-first `@theme` config in `app/globals.css`)
- **Supabase** for data + auth, via `@supabase/ssr` (cookie sessions)
- **Zod** for runtime validation
- Hosted on **Vercel**

## How to run

```bash
cp .env.local.example .env.local   # then fill in Supabase + Anthropic keys
npm install
npm run dev                        # http://localhost:3000
```

Other scripts:

- `npm run build` — production build
- `npm run typecheck` — strict TS, no emit
- `npm run lint` — Next.js ESLint

## Project layout

- `app/` — App Router pages
  - `(app)/` — authenticated app shell, one folder per page
  - `login/` — public auth page + Server Actions
- `components/`
  - `auth/` — `<RoleGate>`
  - `shell/` — Sidebar, Topbar, EntitySwitcher, PageShell, Placeholder
- `lib/`
  - `auth/permissions.ts` — single source of truth for the role matrix
  - `auth/profile.ts` — current-user lookup (cookie → profile + role)
  - `supabase/{server,client,middleware}.ts` — three SSR clients
  - `entities.ts` — entity codes, groups, labels
  - `env.ts` — Zod-validated env reader
  - `utils/cn.ts` — Tailwind class merge helper
- `middleware.ts` — Edge middleware: refreshes Supabase session,
  redirects unauthenticated users to `/login`
- `legacy/` — original vanilla JS app, kept for reference during port

## Roles and access

Roles: `coo`, `bookkeeper`, `cpa`, `admin`. The full page-by-page access
matrix lives in [lib/auth/permissions.ts](lib/auth/permissions.ts) and is
documented in [docs/nextjs-migration-plan.md](docs/nextjs-migration-plan.md).

User → role mapping comes from a `profiles` table (`user_id`, `role`,
`display_name`). On first login of a freshly invited user the role can
also be read from `auth.users.user_metadata.role` as a fallback, so an
admin can grant access via the Supabase dashboard before a profile row
exists.

## Entities

WB Brands LLC, WB Promo (WBP), Lanyard Promo (LP), Koolers Promo (KP),
Band Promo (BP), Swagprint, Rush, One Operations Mgmt (ONEOPS), SP1.

## Notes

- All Supabase reads/writes go through the cookie-bound server client,
  so the anon key stays in the browser only for the public auth flow.
- RLS is **not yet enabled** — authorization is enforced in the app
  layer (middleware + `<PageShell>` + `<RoleGate>`). RLS will be added
  in a later phase per the migration plan.
- The Anthropic API key has not yet been wired up; the AI advisor panel
  will be implemented as a server-side route handler.
