-- ============================================================
-- 0005_cashbook_snapshots.sql
-- Stores raw responses from the SwagPrint Admin API used to
-- populate the Cashbook page. One row per (period_start,
-- period_end, source) — re-fetching the same range overwrites
-- the latest snapshot, but history is preserved by `fetched_at`.
-- ============================================================

create table if not exists public.cashbook_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  source text not null check (source in ('payment_method', 'sales_summary')),
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  fetched_by uuid
);

create index if not exists cashbook_snapshots_range_idx
  on public.cashbook_snapshots (source, period_start desc, period_end desc, fetched_at desc);

-- Latest snapshot per (period_start, period_end, source) — handy view
-- for the page query.
create or replace view public.cashbook_snapshots_latest as
select distinct on (period_start, period_end, source)
  id,
  period_start,
  period_end,
  source,
  payload,
  fetched_at,
  fetched_by
from public.cashbook_snapshots
order by period_start, period_end, source, fetched_at desc;

-- RLS: per the project convention (RLS removed; app-layer authz),
-- enable RLS but grant permissive policies so the anon-key data client
-- can read/write. Authorization is enforced in the Server Action via
-- requireRole().
alter table public.cashbook_snapshots enable row level security;

drop policy if exists "cashbook_snapshots_anon_all" on public.cashbook_snapshots;
create policy "cashbook_snapshots_anon_all" on public.cashbook_snapshots
  for all using (true) with check (true);
