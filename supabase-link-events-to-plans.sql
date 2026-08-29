-- Run this migration manually in the Supabase SQL editor.
-- It links optional plan ideas to shared catalog events.

begin;

alter table public.plans
  add column if not exists event_catalog_id uuid
  references public.event_catalog(id)
  on delete set null;

create unique index if not exists plans_group_event_catalog_unique
  on public.plans (group_id, event_catalog_id)
  where event_catalog_id is not null;

commit;
