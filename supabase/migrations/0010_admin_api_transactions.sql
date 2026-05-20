-- ============================================================
-- 0010_admin_api_transactions.sql
-- Persist Admin API revenue/refund/COGS/ad-spend lines as real
-- rows in `public.transactions` (one row per day × entity ×
-- account-code), linked back to the snapshot fetch that produced
-- them. Re-fetching a period appends new rows; the
-- `transactions_pnl` view dedupes to the latest snapshot so P&L
-- doesn't double-count.
--
-- NOTE: Snapshots fetched before this migration won't show in
-- P&L until the period is re-fetched (the Admin API sales-summary
-- call now uses groupBy=day, so old monthly snapshots wouldn't
-- give daily transactions even if backfilled).
-- ============================================================

alter table public.transactions
  add column if not exists cashbook_snapshot_id uuid
    references public.cashbook_snapshots(id) on delete cascade,
  add column if not exists source text;

create index if not exists transactions_cashbook_snapshot_idx
  on public.transactions (cashbook_snapshot_id)
  where cashbook_snapshot_id is not null;

-- Read-side view: any transaction that is not API-sourced passes
-- through unchanged; API-sourced rows are filtered to only those
-- belonging to the latest snapshot per (period_start, period_end,
-- source). This is what P&L and drill-down should read from.
create or replace view public.transactions_pnl as
select t.*
from public.transactions t
where t.cashbook_snapshot_id is null
   or t.cashbook_snapshot_id in (
     select id from public.cashbook_snapshots_latest
   );
