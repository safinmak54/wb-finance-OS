-- ============================================================
-- 0018_transactions_checksum_admin_api_stable_date.sql
--
-- DATE-TYPED VARIANT of 0018_transactions_checksum_admin_api_stable.sql.
-- Apply THIS file (not the text-typed 0018) when `transactions.txn_date`
-- and `transactions.acc_date` are real `date` columns — which is the case
-- on production. Behaviour is identical to the text-typed 0018; only the
-- way dates feed the checksum changes.
--
-- Why a separate version is needed
-- --------------------------------
-- The text-typed 0018 takes `p_txn_date text` / `p_acc_date text` and the
-- generated column passes the `txn_date` / `acc_date` columns straight in.
-- When those columns are `date`, that call site implicitly casts
-- `date -> text` via `date_out`, which is STABLE (it honours the DateStyle
-- GUC), not IMMUTABLE. A generated STORED column re-checks the volatility
-- of its call-site argument expressions, so it would be rejected with
-- "generation expression is not immutable".
--
-- The fix: give the function `date` parameters and normalize the date to a
-- DateStyle-independent `YYYY-MM-DD` string INSIDE the function. For a
-- generated column Postgres trusts the function's declared IMMUTABLE
-- volatility (it does not re-derive the body), and the call site now passes
-- the bare `txn_date` / `acc_date` column references, which ARE immutable.
-- `to_char(d, 'YYYY-MM-DD')` is deterministic regardless of session
-- DateStyle/locale (the numeric format codes don't depend on either), and
-- yields exactly the `YYYY-MM-DD` representation the text-typed columns held,
-- so checksums stay consistent with the rest of the system.
--
-- The dedupe semantics are unchanged from the text-typed 0018:
--   * Admin-API synthesized rows (`source like 'admin_api:%'`) hash CONTENT
--     ONLY — dropping the per-sync identity fields (raw_transaction_id, memo)
--     so a re-sync of identical data collides on the unique index and is
--     ignored. Content is unique per (day x entity x account x source) by
--     construction (lib/admin-api/synthesize-transactions.ts), so this never
--     collapses two genuinely-distinct rows.
--   * All other rows keep raw_transaction_id + memo (migration 0017), so
--     identical recurring charges stay distinct.
-- ============================================================

create extension if not exists pgcrypto;

-- The generated column depends on the function, so drop it (and its index)
-- before swapping the function. Unlike the text-typed 0018 the function
-- SIGNATURE changes here (date params instead of text), so `create or
-- replace` would create an OVERLOAD rather than replace — drop the old
-- signatures explicitly first. Dropping and re-adding the column also forces
-- every row to recompute under the new formula.
drop index if exists transactions_checksum_uniq;
alter table public.transactions drop column if exists checksum;
drop function if exists public.transactions_checksum(
  text, text, numeric, text, text, text, text, text, text
);  -- 0017 / text-typed-0018 signature (all text, 9 args)
drop function if exists public.transactions_checksum(
  text, text, numeric, text, text, text, text
);  -- 0016 signature (7 args), in case this runs on a pre-0017 db

-- txn_date / acc_date are `date`; everything else matches 0017/0018.
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
      coalesce(p_entity, '')                          || '|' ||
      coalesce(p_account_id, '')                      || '|' ||
      coalesce(round(p_amount, 2)::text, '')          || '|' ||
      coalesce(p_description, '')                      || '|' ||
      -- DateStyle-independent normalization (see header). Matches the
      -- `YYYY-MM-DD` strings the text-typed columns used to store.
      coalesce(to_char(p_txn_date, 'YYYY-MM-DD'), '')  || '|' ||
      coalesce(to_char(p_acc_date, 'YYYY-MM-DD'), '')  || '|' ||
      coalesce(p_source, '')                           ||
      -- Admin-API synthesized rows: hash content only. Every sync re-mints
      -- raw_transaction_id, so including identity fields would give the same
      -- logical line a new checksum each run and defeat the unique index.
      -- Content is unique per (day x entity x account x source) by
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
      txn_date,          -- bare `date` column reference (immutable)
      acc_date,          -- bare `date` column reference (immutable)
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
