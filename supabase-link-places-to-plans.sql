-- Run this migration manually in the Supabase SQL editor.
-- It links optional plan ideas to catalog places without mixing event links.

begin;

alter table public.plans
  add column if not exists place_catalog_id uuid
  references public.place_catalog(id)
  on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.plans'::regclass
      and conname = 'plans_single_catalog_source_check'
  ) then
    alter table public.plans
      add constraint plans_single_catalog_source_check check (
        not (
          event_catalog_id is not null
          and place_catalog_id is not null
        )
      );
  end if;
end
$$;

create unique index if not exists plans_group_place_catalog_unique
  on public.plans (group_id, place_catalog_id)
  where place_catalog_id is not null;

commit;
