-- ============================================================
-- 0018_transactions_checksum_admin_api_stable.sql
-- Makes the `transactions` content checksum (migrations 0016 + 0017)
-- DEDUPE admin-API sync rows across re-syncs, so re-clicking
-- "Refresh from Admin API" can never create duplicate rows.
--
-- The problem
-- -----------
-- 0017 folded `raw_transaction_id` (and `memo`) into the checksum so two
-- genuinely-distinct look-alike bank charges stay distinct. But the
-- cashbook sync (actions/cashbook.ts) re-creates `raw_transactions` from
-- scratch on every run, so each sync gives the SAME logical line a BRAND
-- NEW raw_transaction_id -> a brand new checksum. The unique index then
-- never sees the two syncs as equal, so `on conflict (checksum) do
-- nothing` is a no-op for them and the only thing preventing duplicates
-- was a non-atomic delete-then-reinsert by date range — which races on
-- concurrent clicks / two tabs and misses legacy rows whose `source` was
-- never tagged.
--
-- The fix
-- -------
-- Admin-API rows are synthesized exactly one per (day × entity × account
-- × source) — see lib/admin-api/synthesize-transactions.ts — so their
-- CONTENT (entity, account, amount, description, txn_date, acc_date,
-- source) is already unique per logical line. Hashing only that content
-- for `source like 'admin_api:%'` rows (dropping the per-sync identity
-- fields) makes a re-sync of identical data collide on the unique index
-- and get ignored — a DB-enforced guarantee that holds regardless of
-- concurrency, tabs, or the app-side delete racing.
--
-- All other rows (manual classify, journal lines whose memo is `je:<id>`,
-- bank imports) keep the 0017 behaviour with raw_transaction_id + memo,
-- so identical recurring charges stay distinct.
-- ============================================================

create extension if not exists pgcrypto;

-- The generated column depends on the function, so drop it (and its index)
-- before replacing the function body; otherwise stored checksums would keep
-- their old (pre-0018) values until each row is next updated. Dropping and
-- re-adding the column forces every row to recompute under the new formula.
-- The signature also changes here (txn_date / acc_date are `date` params,
-- not `text` — see note below), so drop the old function too.
drop index if exists transactions_checksum_uniq;
alter table public.transactions drop column if exists checksum;
-- Drop both possible 9-arg overloads: the `date,date` one produced by 0017,
-- and the all-`text` one a partially-applied earlier draft of this migration
-- may have left behind. Dropping a non-existent signature is a no-op.
drop function if exists public.transactions_checksum(
  text, text, numeric, text, date, date, text, text, text
);
drop function if exists public.transactions_checksum(
  text, text, numeric, text, text, text, text, text, text
);

-- The function keeps 0017's signature (txn_date / acc_date are `date` params,
-- normalized to `YYYY-MM-DD` inside; see 0016's note) and only changes the
-- body: it now branches on `source` so admin_api rows hash content only.
create or replace function public.transactions_checksum(
  p_entity              text,
  p_account_id          text,
  p_amount              numeric,
  p_description         text,
  p_txn_date            date,
  p_acc_date            date,
  p_source              text,
  p_raw_transaction_id  text,
  p_memo                text
) returns text
language sql
immutable
set search_path = extensions, public, pg_catalog
as $$
  select encode(
    digest(
      coalesce(p_entity, '')                   || '|' ||
      coalesce(p_account_id, '')               || '|' ||
      coalesce(round(p_amount, 2)::text, '')   || '|' ||
      coalesce(p_description, '')              || '|' ||
      coalesce(to_char(p_txn_date, 'YYYY-MM-DD'), '') || '|' ||
      coalesce(to_char(p_acc_date, 'YYYY-MM-DD'), '') || '|' ||
      coalesce(p_source, '')                   ||
      -- Admin-API synthesized rows: hash content only. Every sync re-mints
      -- raw_transaction_id, so including identity fields would give the same
      -- logical line a new checksum each run and defeat the unique index.
      -- Content is unique per (day × entity × account × source) by
      -- construction, so this can't collapse two genuinely-distinct rows.
      -- All other rows: keep raw_transaction_id + memo (migration 0017).
      case
        when p_source like 'admin_api:%' then ''
        else '|' || coalesce(p_raw_transaction_id, '') ||
             '|' || coalesce(p_memo, '')
      end,
      'sha256'
    ),
    'hex'
  )
$$;

alter table public.transactions
  add column checksum text generated always as (
    public.transactions_checksum(
      entity,
      account_id::text,
      amount::numeric,
      description,
      txn_date,
      acc_date,
      source,
      raw_transaction_id::text,
      memo
    )
  ) stored;

-- Collapse any rows that are duplicates under the new admin_api content-only
-- checksum. Admin-API rows that were distinct only by raw_transaction_id now
-- share a checksum, so this keeps one per logical line. Non-admin rows are
-- unaffected (their checksum is unchanged from 0017). Must run before the
-- unique index is rebuilt, or the index build would fail.
delete from public.transactions a
using public.transactions b
where a.checksum = b.checksum
  and a.ctid > b.ctid;

-- The collapse above orphans the `raw_transactions` rows that backed the
-- removed duplicate transactions (admin_api raw rows are 1:1 with their
-- transaction). Sweep the now-childless admin_api raw rows so the inbox /
-- counts stay consistent. Only rows with no surviving transaction are
-- removed, so this never touches a live row.
delete from public.raw_transactions r
where r.source = 'admin_api'
  and not exists (
    select 1 from public.transactions t where t.raw_transaction_id = r.id
  );

create unique index transactions_checksum_uniq
  on public.transactions (checksum);
