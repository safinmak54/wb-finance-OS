-- ============================================================
-- 0017_transactions_checksum_identity.sql
-- Widens the `transactions` content checksum (migration 0016) to
-- include `raw_transaction_id` and `memo`.
--
-- 0016's checksum hashed only content fields
-- (entity, account_id, amount, description, txn_date, acc_date,
-- source). That collapsed genuinely-distinct rows that happened to
-- share content — e.g. two identical recurring payroll / rent /
-- subscription bank charges classified to the same account on the
-- same day. The second `insert ... on conflict (checksum) do nothing`
-- was silently ignored while its raw row was still flipped to
-- classified, so the money never reached the P&L.
--
-- Adding the row's identity fields fixes that without weakening
-- intended dedup:
--   * raw_transaction_id — distinguishes two distinct bank rows;
--     re-classifying the SAME raw row still hashes identically, so a
--     re-classify stays a safe no-op.
--   * memo — journal lines carry `je:<id>`, so re-posting an identical
--     journal entry no longer collides with the original; identical
--     lines WITHIN one JE still share a checksum and dedupe.
-- Cashbook-synced rows set raw_transaction_id per synthesized row and
-- continue to rely on the date-range delete + snapshot view for their
-- cross-sync dedup, so this is a no-op for them.
-- ============================================================

create extension if not exists pgcrypto;

-- Drop the generated column and its unique index first; the column
-- depends on the old function signature, so the function can't be
-- replaced (new arg list) while the column references it.
drop index if exists transactions_checksum_uniq;
alter table public.transactions drop column if exists checksum;
drop function if exists public.transactions_checksum(
  text, text, numeric, text, date, date, text
);

-- txn_date / acc_date are `date` params (see 0016's note): taken cast-free at
-- the call site and normalized to `YYYY-MM-DD` inside this IMMUTABLE function.
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
      coalesce(p_source, '')                   || '|' ||
      coalesce(p_raw_transaction_id, '')       || '|' ||
      coalesce(p_memo, ''),
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

-- Collapse any rows that are still duplicates under the wider key
-- (identical content AND raw_transaction_id AND memo). Anything distinct
-- under 0016's narrower key stays distinct here, so this only removes
-- true duplicates before the unique index is rebuilt.
delete from public.transactions a
using public.transactions b
where a.checksum = b.checksum
  and a.ctid > b.ctid;

create unique index transactions_checksum_uniq
  on public.transactions (checksum);
