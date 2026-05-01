-- ============================================================
-- 0002_enable_rls.sql
-- Enable RLS on every public table and install role-based policies
-- that match lib/auth/permissions.ts.
--
-- Roles come from `profiles.role` (also mirrored in
-- `auth.users.user_metadata.role`). The `current_role_value()`
-- helper resolves the caller's role from the JWT, falling back to
-- the profiles table.
-- ============================================================

-- ---------- helper: current role ----------
create or replace function public.current_role_value()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() -> 'user_metadata' ->> 'role'),
    (select role from profiles where user_id = auth.uid())
  );
$$;

create or replace function public.is_role(check_role text)
returns boolean
language sql
stable
as $$
  select public.current_role_value() = check_role;
$$;

create or replace function public.is_role_in(check_roles text[])
returns boolean
language sql
stable
as $$
  select public.current_role_value() = any(check_roles);
$$;

-- ---------- enable RLS on every public table ----------
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not like 'pg_%'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- ---------- profiles: each user sees own row; admin sees all ----------
drop policy if exists "profiles_self_read" on profiles;
create policy "profiles_self_read" on profiles
  for select using (
    user_id = auth.uid() or public.is_role('admin')
  );

drop policy if exists "profiles_admin_write" on profiles;
create policy "profiles_admin_write" on profiles
  for all using (public.is_role('admin'))
  with check (public.is_role('admin'));

-- ---------- entities, accounts: every authenticated user reads ----------
drop policy if exists "entities_read" on entities;
create policy "entities_read" on entities for select using (auth.uid() is not null);

drop policy if exists "entities_write" on entities;
create policy "entities_write" on entities for all
  using (public.is_role_in(array['bookkeeper','admin']))
  with check (public.is_role_in(array['bookkeeper','admin']));

drop policy if exists "accounts_read" on accounts;
create policy "accounts_read" on accounts for select using (auth.uid() is not null);

drop policy if exists "accounts_write" on accounts;
create policy "accounts_write" on accounts for all
  using (public.is_role_in(array['bookkeeper','cpa','admin']))
  with check (public.is_role_in(array['bookkeeper','cpa','admin']));

-- ---------- vendors / invoices ----------
drop policy if exists "vendors_read" on vendors;
create policy "vendors_read" on vendors for select using (auth.uid() is not null);

drop policy if exists "vendors_write" on vendors;
create policy "vendors_write" on vendors for all
  using (public.is_role_in(array['coo','bookkeeper','admin']))
  with check (public.is_role_in(array['coo','bookkeeper','admin']));

drop policy if exists "invoices_read" on invoices;
create policy "invoices_read" on invoices for select using (auth.uid() is not null);

drop policy if exists "invoices_write" on invoices;
create policy "invoices_write" on invoices for all
  using (public.is_role_in(array['coo','bookkeeper','admin']))
  with check (public.is_role_in(array['coo','bookkeeper','admin']));

-- ---------- raw_transactions / transactions / journal_entries / ledger_entries ----------
-- read for any authenticated; CPA is read-only on financials.
drop policy if exists "raw_txn_read" on raw_transactions;
create policy "raw_txn_read" on raw_transactions for select using (auth.uid() is not null);

drop policy if exists "raw_txn_write" on raw_transactions;
create policy "raw_txn_write" on raw_transactions for all
  using (public.is_role_in(array['bookkeeper','admin']))
  with check (public.is_role_in(array['bookkeeper','admin']));

drop policy if exists "txn_read" on transactions;
create policy "txn_read" on transactions for select using (auth.uid() is not null);

drop policy if exists "txn_write" on transactions;
create policy "txn_write" on transactions for all
  using (public.is_role_in(array['bookkeeper','admin']))
  with check (public.is_role_in(array['bookkeeper','admin']));

drop policy if exists "je_read" on journal_entries;
create policy "je_read" on journal_entries for select using (auth.uid() is not null);

drop policy if exists "je_write" on journal_entries;
create policy "je_write" on journal_entries for all
  using (public.is_role_in(array['coo','bookkeeper','admin']))
  with check (public.is_role_in(array['coo','bookkeeper','admin']));

drop policy if exists "le_read" on ledger_entries;
create policy "le_read" on ledger_entries for select using (auth.uid() is not null);

drop policy if exists "le_write" on ledger_entries;
create policy "le_write" on ledger_entries for all
  using (public.is_role_in(array['coo','bookkeeper','admin']))
  with check (public.is_role_in(array['coo','bookkeeper','admin']));

-- ---------- classification_rules ----------
drop policy if exists "rules_read" on classification_rules;
create policy "rules_read" on classification_rules for select using (auth.uid() is not null);

drop policy if exists "rules_write" on classification_rules;
create policy "rules_write" on classification_rules for all
  using (public.is_role_in(array['bookkeeper','admin']))
  with check (public.is_role_in(array['bookkeeper','admin']));

-- ---------- closed_periods ----------
drop policy if exists "closed_read" on closed_periods;
create policy "closed_read" on closed_periods for select using (auth.uid() is not null);

drop policy if exists "closed_write" on closed_periods;
create policy "closed_write" on closed_periods for all
  using (public.is_role_in(array['coo','bookkeeper','admin']))
  with check (public.is_role_in(array['coo','bookkeeper','admin']));

-- ---------- cash_balances ----------
drop policy if exists "cb_read" on cash_balances;
create policy "cb_read" on cash_balances for select using (auth.uid() is not null);

drop policy if exists "cb_write" on cash_balances;
create policy "cb_write" on cash_balances for all
  using (public.is_role_in(array['coo','bookkeeper','cpa','admin']))
  with check (public.is_role_in(array['coo','bookkeeper','cpa','admin']));

-- ---------- reconciliation_matches ----------
drop policy if exists "recon_read" on reconciliation_matches;
create policy "recon_read" on reconciliation_matches for select using (auth.uid() is not null);

drop policy if exists "recon_write" on reconciliation_matches;
create policy "recon_write" on reconciliation_matches for all
  using (public.is_role_in(array['coo','bookkeeper','admin']))
  with check (public.is_role_in(array['coo','bookkeeper','admin']));

-- ---------- ap_items ----------
drop policy if exists "ap_read" on ap_items;
create policy "ap_read" on ap_items for select using (auth.uid() is not null);

drop policy if exists "ap_write" on ap_items;
create policy "ap_write" on ap_items for all
  using (public.is_role_in(array['coo','cpa','admin']))
  with check (public.is_role_in(array['coo','cpa','admin']));

-- ---------- cfo_notes ----------
drop policy if exists "cfo_read" on cfo_notes;
create policy "cfo_read" on cfo_notes for select
  using (public.is_role_in(array['coo','cpa','admin']));

drop policy if exists "cfo_write" on cfo_notes;
create policy "cfo_write" on cfo_notes for all
  using (public.is_role_in(array['coo','cpa','admin']))
  with check (public.is_role_in(array['coo','cpa','admin']));

-- ---------- bank_connections ----------
drop policy if exists "bank_read" on bank_connections;
create policy "bank_read" on bank_connections for select using (auth.uid() is not null);

drop policy if exists "bank_write" on bank_connections;
create policy "bank_write" on bank_connections for all
  using (public.is_role_in(array['coo','admin']))
  with check (public.is_role_in(array['coo','admin']));
