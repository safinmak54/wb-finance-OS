-- ============================================================
-- 0004_audit_log.sql
-- Append-only audit log + per-table triggers that capture
-- OLD/NEW as JSONB. The app also writes log rows from Server
-- Actions (actions/_audit.ts), so we have both belt-and-braces.
-- ============================================================

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  table_name text not null,
  row_id text,
  op text not null check (op in ('INSERT','UPDATE','DELETE')),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create index if not exists audit_log_table_idx on public.audit_log (table_name, at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_user_id, at desc);

-- RLS: append-only. Read is admin-only; writes happen through the
-- trigger (security definer) — direct writes from the client are
-- denied.
alter table public.audit_log enable row level security;

drop policy if exists "audit_log_admin_read" on audit_log;
create policy "audit_log_admin_read" on audit_log for select
  using (public.is_role('admin'));

drop policy if exists "audit_log_no_direct_write" on audit_log;
create policy "audit_log_no_direct_write" on audit_log for all
  using (false) with check (false);

-- ---------- generic capture trigger ----------
create or replace function public.audit_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
begin
  actor := auth.uid();

  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_user_id, table_name, row_id, op, after)
      values (actor, tg_table_name, coalesce(new.id::text, null), 'INSERT', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor_user_id, table_name, row_id, op, before, after)
      values (actor, tg_table_name, coalesce(new.id::text, null), 'UPDATE',
              to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor_user_id, table_name, row_id, op, before)
      values (actor, tg_table_name, coalesce(old.id::text, null), 'DELETE', to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

-- ---------- attach to mutating tables ----------
do $$
declare
  tbl text;
  targets text[] := array[
    'vendors',
    'invoices',
    'accounts',
    'raw_transactions',
    'transactions',
    'journal_entries',
    'ledger_entries',
    'closed_periods',
    'cash_balances',
    'reconciliation_matches',
    'ap_items',
    'cfo_notes',
    'bank_connections',
    'classification_rules'
  ];
begin
  foreach tbl in array targets loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = tbl
    ) then
      execute format(
        'drop trigger if exists audit_%I on public.%I; create trigger audit_%I after insert or update or delete on public.%I for each row execute procedure public.audit_capture();',
        tbl, tbl, tbl, tbl
      );
    end if;
  end loop;
end $$;
