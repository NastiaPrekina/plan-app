-- Run this migration manually in the Supabase SQL editor.
-- It creates the shared event catalog and private per-user reactions.

begin;

create table if not exists public.event_catalog (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_event_id text not null,
  title text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  place_name text,
  address text,
  price text,
  is_free boolean,
  image_url text,
  source_url text not null,
  categories text[] not null default '{}',
  city text,
  age_restriction text,
  source_payload jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_catalog_source_event_key unique (source, source_event_id)
);

create index if not exists event_catalog_city_starts_at_idx
  on public.event_catalog (city, starts_at);

create index if not exists event_catalog_last_seen_at_idx
  on public.event_catalog (last_seen_at desc);

create table if not exists public.event_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.event_catalog(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_feedback_user_event_key unique (user_id, event_id),
  constraint event_feedback_reaction_check check (
    reaction in ('interested', 'not_interested', 'wishlist')
  )
);

create index if not exists event_feedback_user_reaction_idx
  on public.event_feedback (user_id, reaction);

create index if not exists event_feedback_event_id_idx
  on public.event_feedback (event_id);

create or replace function public.set_event_recommendation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_event_catalog_updated_at
on public.event_catalog;
create trigger set_event_catalog_updated_at
before update on public.event_catalog
for each row execute function public.set_event_recommendation_updated_at();

drop trigger if exists set_event_feedback_updated_at
on public.event_feedback;
create trigger set_event_feedback_updated_at
before update on public.event_feedback
for each row execute function public.set_event_recommendation_updated_at();

alter table public.event_catalog enable row level security;
alter table public.event_feedback enable row level security;

drop policy if exists "Authenticated users read event catalog"
on public.event_catalog;
create policy "Authenticated users read event catalog"
on public.event_catalog for select
to authenticated
using (true);

-- The frontend receives read-only catalog access. The Edge Function writes
-- with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
revoke all on public.event_catalog from anon, authenticated;
grant select on public.event_catalog to authenticated;

drop policy if exists "Users read own event feedback"
on public.event_feedback;
create policy "Users read own event feedback"
on public.event_feedback for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users create own event feedback"
on public.event_feedback;
create policy "Users create own event feedback"
on public.event_feedback for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users update own event feedback"
on public.event_feedback;
create policy "Users update own event feedback"
on public.event_feedback for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users delete own event feedback"
on public.event_feedback;
create policy "Users delete own event feedback"
on public.event_feedback for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete
on public.event_feedback to authenticated;

commit;
