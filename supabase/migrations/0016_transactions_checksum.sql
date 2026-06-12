-- ============================================================
-- 0016_transactions_checksum.sql
-- Adds a content checksum to `transactions` so the same logical
-- transaction is never stored twice. Until now only the cashbook
-- Admin-API sync deduped (delete + re-insert a date range); manual
-- classify, bulk classify and journal posting had no dedup at all.
--
-- The checksum is a generated STORED column (SHA-256 over the
-- content fields) so the hash is computed in one place, existing
-- rows backfill automatically, and app inserts only need to opt
-- into `on conflict (checksum) do nothing`.
--
-- Dedup is strict: identical field-sets are the same transaction.
-- `source` is included, so cashbook-synced rows (source set) and
-- manual / journal rows (source null) dedupe within their own kind.
-- ============================================================

-- digest() lives in pgcrypto.
create extension if not exists pgcrypto;

-- 1. Checksum function.
--    A generated STORED column requires an IMMUTABLE expression. Inlining
--    the encode(digest(...)) hash was rejected with "generation expression
--    is not immutable"; wrapping it in an IMMUTABLE-declared function fixes
--    that, because for a generated column Postgres trusts a called
--    function's declared volatility (it does not re-derive the body) — it
--    only re-checks the call-site argument expressions, and both casts here
--    (uuid::text, numeric::numeric) are immutable. This also keeps the hash
--    computed in one place. txn_date / acc_date are already `text` columns
--    holding normalized `YYYY-MM-DD` strings, so they hash as-is.
--    round(amount, 2) normalizes representation so equal money values hash
--    identically. search_path is pinned so digest() resolves whether
--    pgcrypto landed in `extensions` (Supabase default) or `public`.
create or replace function public.transactions_checksum(
  p_entity      text,
  p_account_id  text,
  p_amount      numeric,
  p_description text,
  p_txn_date    text,
  p_acc_date    text,
  p_source      text
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
      coalesce(p_txn_date, '')                 || '|' ||
      coalesce(p_acc_date, '')                 || '|' ||
      coalesce(p_source, ''),
      'sha256'
    ),
    'hex'
  )
$$;

-- 2. Generated checksum column.
alter table public.transactions
  add column checksum text generated always as (
    public.transactions_checksum(
      entity,
      account_id::text,
      amount::numeric,
      description,
      txn_date,
      acc_date,
      source
    )
  ) stored;

-- 3. Collapse pre-existing duplicates (a unique index fails otherwise).
--    Keeps one row per checksum. Destructive for historical data that
--    pre-dates dedup — preview with the rows_to_delete query in the
--    plan's Verification section before applying to production.
delete from public.transactions a
using public.transactions b
where a.checksum = b.checksum
  and a.ctid > b.ctid;

-- 4. Enforce uniqueness.
create unique index transactions_checksum_uniq
  on public.transactions (checksum);
