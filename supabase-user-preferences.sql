-- Run this migration manually in the Supabase SQL editor.
-- It stores a private, user-owned taste profile and onboarding state.

begin;

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preference_text text,
  city text,
  onboarding_completed boolean not null default false,
  calibration_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_city_check check (
    city is null or city in ('msk', 'spb')
  )
);

create or replace function public.set_user_preferences_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_preferences_updated_at
on public.user_preferences;
create trigger set_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_user_preferences_updated_at();

alter table public.user_preferences enable row level security;

drop policy if exists "Users read own preferences"
on public.user_preferences;
create policy "Users read own preferences"
on public.user_preferences for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users create own preferences"
on public.user_preferences;
create policy "Users create own preferences"
on public.user_preferences for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users update own preferences"
on public.user_preferences;
create policy "Users update own preferences"
on public.user_preferences for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update
on public.user_preferences to authenticated;

commit;
