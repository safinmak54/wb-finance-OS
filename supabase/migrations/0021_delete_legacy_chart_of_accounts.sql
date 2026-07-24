-- ============================================================
-- 0021_delete_legacy_chart_of_accounts.sql
-- HARD-DELETES every account that is NOT part of the v2 Chart of
-- Accounts (0020) — AND the posted history attached to it.
--
-- Apply 0020 FIRST. "Legacy" = any account whose account_code is
-- not one of the 70 v2 codes listed below. This keeps the four
-- shared codes 6001/6002/6003/6004 (repurposed by 0020), so the
-- historical ad transactions sitting on those four codes are NOT
-- removed — they stay attached to the now-relabeled comp accounts.
--
-- ⚠️  DESTRUCTIVE / IRREVERSIBLE — READ BEFORE APPLYING  ⚠️
--   Earlier attempts failed twice on schema surprises:
--     1) transactions_account_id_fkey blocked a plain delete
--        (proof the live GL is posted against these accounts);
--     2) a hard-coded delete referenced public.pnl_manual_entries,
--        which DOES NOT EXIST on this database (lib/supabase/types.ts
--        only approximates the live schema and cannot be trusted).
--   So this version does NOT hard-code dependent tables. It reads
--   the real foreign keys from the Postgres catalog (pg_constraint)
--   and recursively deletes every row that (transitively) points at
--   a legacy account — deepest dependents first — then the accounts.
--   Tables that don't exist simply have no FK and are skipped.
--
--   Because the live ledger sits on OLD codes, this removes the bulk
--   of your posted transaction / ledger / reconciliation history.
--   THERE IS NO UNDO. Take a full database backup / snapshot first.
--   Runs atomically: any error rolls the whole thing back.
-- ============================================================

-- Session-temp helper: delete every row that references p_rel's rows
-- (identified by uuid PK values in p_ids), recursing into grandchildren
-- first so RESTRICT foreign keys never block us. Auto-dropped at end of
-- session; created with `or replace` so re-running is safe.
create or replace function pg_temp._purge(p_rel regclass, p_ids uuid[])
returns void
language plpgsql
as $fn$
declare
  fk        record;
  pk_col    text;
  pk_type   text;
  child_ids uuid[];
  n         bigint;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return;
  end if;

  -- every single-column foreign key that references p_rel
  for fk in
    select c.conrelid::regclass as child_rel,
           (select attname from pg_attribute
             where attrelid = c.conrelid and attnum = c.conkey[1]) as child_col
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = p_rel
      and array_length(c.conkey, 1) = 1
  loop
    -- if the child has a single-column uuid PK, recurse into ITS
    -- referrers before deleting the child rows themselves
    select a.attname, t.typname
      into pk_col, pk_type
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    join pg_type t      on t.oid = a.atttypid
    where i.indrelid = fk.child_rel and i.indisprimary and i.indnatts = 1;

    if pk_col is not null and pk_type = 'uuid' then
      execute format('select array_agg(%I) from %s where %I = any($1)',
                     pk_col, fk.child_rel, fk.child_col)
        into child_ids using p_ids;
      perform pg_temp._purge(fk.child_rel, child_ids);
    end if;

    execute format('delete from %s where %I = any($1)', fk.child_rel, fk.child_col)
      using p_ids;
    get diagnostics n = row_count;
    if n > 0 then
      raise notice '  purged % row(s) from %', n, fk.child_rel;
    end if;
  end loop;
end
$fn$;

do $$
declare
  v_keep text[] := array[
    -- §4.2 Income Statement (35)
    '4001','4002','4003','4011','4012','4013','4021','4022','4023','4031',
    '5001','5002','5011','5012','5013','5015','5016','5017',
    '6001','6002','6003','6004',
    '7001','7002','7003','7004','7005','7006','7007','7008','7009','7010','7011','7012','7013',
    -- §4.3 Balance Sheet (35)
    '1001','1002','1003','1004','1005','1006','1007',
    '1011','1012','1013','1014','1021','1031','1041',
    '2001','2002','2003','2004','2011','2021','2022','2023','2024',
    '2031','2032','2033','2041','2042','2043','2044','2045','2046',
    '3001','3002','3003'
  ];
  v_old uuid[];
  n     bigint;
begin
  select array_agg(id) into v_old
  from public.accounts
  where account_code <> all (v_keep);

  if coalesce(array_length(v_old, 1), 0) = 0 then
    raise notice 'No legacy accounts found; nothing to delete.';
    return;
  end if;

  raise notice 'Purging dependents of % legacy account(s)...', array_length(v_old, 1);
  perform pg_temp._purge('public.accounts'::regclass, v_old);

  delete from public.accounts where id = any (v_old);
  get diagnostics n = row_count;
  raise notice 'Deleted % legacy account(s).', n;
end $$;
