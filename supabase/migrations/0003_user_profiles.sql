-- ============================================================
-- 0003_user_profiles.sql
-- Ensure the `profiles` table matches the structure assumed in
-- lib/auth/profile.ts. Idempotent: safe to run on a DB that
-- already has profiles set up.
-- ============================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text check (role in ('coo','bookkeeper','cpa','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists profiles_role_idx on public.profiles(role);

-- Auto-create a profile row when a new auth user is created. The
-- role can come from user_metadata.role (set by Admin → Users page).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', null),
    coalesce(new.raw_user_meta_data ->> 'role', null)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
