-- Run this migration manually in the Supabase SQL editor.
-- It stores structured Foursquare Places Pro fields used by place discovery.

begin;

alter table public.place_catalog
  add column if not exists locality text,
  add column if not exists region text,
  add column if not exists postcode text,
  add column if not exists distance_meters double precision,
  add column if not exists email text,
  add column if not exists instagram text,
  add column if not exists facebook_id text,
  add column if not exists twitter text,
  add column if not exists chain_id text,
  add column if not exists chain_name text,
  add column if not exists is_chain boolean not null default false,
  add column if not exists store_id text,
  add column if not exists related_places jsonb,
  add column if not exists date_closed date,
  add column if not exists unresolved_flags text[] not null default '{}';

commit;
