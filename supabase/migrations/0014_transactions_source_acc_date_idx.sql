-- ============================================================
-- 0014_transactions_source_acc_date_idx.sql
-- The Admin API sync (actions/cashbook.ts) now dedupes synthesized
-- rows at the DAY grain instead of by snapshot period: before
-- re-inserting a range it deletes every admin-sourced transaction
-- whose `acc_date` falls in [startDate, endDate] for that `source`.
-- This is what makes overlapping syncs (e.g. a YTD refresh and a
-- single-month refresh) safe — each (source, entity, account, day)
-- ends up represented exactly once.
--
-- That delete/select filters on (source, acc_date), so back it with
-- an index. Partial on `source is not null` since only API-sourced
-- rows carry a source today.
-- ============================================================

create index if not exists transactions_source_acc_date_idx
  on public.transactions (source, acc_date)
  where source is not null;
