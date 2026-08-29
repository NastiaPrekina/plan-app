-- Run this migration manually in the Supabase SQL editor.
-- It creates a provider-agnostic catalog of real places.

begin;

create table if not exists public.place_catalog (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_place_id text not null,
  name text not null,
  kind text not null,
  categories text[] not null default '{}',
  cuisine text[] not null default '{}',
  address text,
  lat double precision,
  lon double precision,
  website text,
  phone text,
  rating double precision,
  popularity double precision,
  price_level integer,
  opening_hours jsonb,
  city text,
  source_url text,
  source_payload jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_catalog_source_place_key unique (source, source_place_id),
  constraint place_catalog_kind_check check (
    kind in ('restaurant', 'cafe', 'bar')
  ),
  constraint place_catalog_price_level_check check (
    price_level is null or price_level between 1 and 4
  )
);

create index if not exists place_catalog_city_kind_idx
  on public.place_catalog (city, kind);

create or replace function public.set_place_catalog_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_place_catalog_updated_at
on public.place_catalog;
create trigger set_place_catalog_updated_at
before update on public.place_catalog
for each row execute function public.set_place_catalog_updated_at();

alter table public.place_catalog enable row level security;

drop policy if exists "Authenticated users read place catalog"
on public.place_catalog;
create policy "Authenticated users read place catalog"
on public.place_catalog for select
to authenticated
using (true);

revoke all on public.place_catalog from anon, authenticated;
grant select on public.place_catalog to authenticated;

commit;
