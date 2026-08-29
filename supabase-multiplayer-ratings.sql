-- Run this migration manually in the Supabase SQL editor.
-- It makes ratings personal while exposing group results only as aggregates.

begin;

alter table public.plan_desires
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.event_ratings
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Legacy rows had no author. Assign them to the owner of the plan's group so
-- existing scores are preserved. The checks below stop the migration if an
-- orphaned legacy row cannot be assigned safely.
update public.plan_desires desire
set user_id = groups.created_by
from public.plans plan
join public.groups groups on groups.id = plan.group_id
where desire.plan_id = plan.id
  and desire.user_id is null;

update public.event_ratings rating
set user_id = groups.created_by
from public.plan_events event
join public.plans plan on plan.id = event.plan_id
join public.groups groups on groups.id = plan.group_id
where rating.plan_event_id = event.id
  and rating.user_id is null;

do $$
begin
  if exists (select 1 from public.plan_desires where user_id is null) then
    raise exception 'Some plan_desires rows could not be assigned to a group owner';
  end if;

  if exists (select 1 from public.event_ratings where user_id is null) then
    raise exception 'Some event_ratings rows could not be assigned to a group owner';
  end if;
end
$$;

alter table public.plan_desires alter column user_id set not null;
alter table public.event_ratings alter column user_id set not null;

-- Remove the old one-rating-per-plan/event unique constraints, regardless of
-- their generated names.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_record.conname
    from pg_constraint constraint_record
    join pg_class table_record on table_record.oid = constraint_record.conrelid
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'public'
      and table_record.relname = 'plan_desires'
      and constraint_record.contype = 'u'
      and constraint_record.conkey = array[
        (select attnum from pg_attribute where attrelid = table_record.oid and attname = 'plan_id')
      ]::smallint[]
  loop
    execute format('alter table public.plan_desires drop constraint %I', constraint_name);
  end loop;

  for constraint_name in
    select constraint_record.conname
    from pg_constraint constraint_record
    join pg_class table_record on table_record.oid = constraint_record.conrelid
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'public'
      and table_record.relname = 'event_ratings'
      and constraint_record.contype = 'u'
      and constraint_record.conkey = array[
        (select attnum from pg_attribute where attrelid = table_record.oid and attname = 'plan_event_id')
      ]::smallint[]
  loop
    execute format('alter table public.event_ratings drop constraint %I', constraint_name);
  end loop;
end
$$;

create unique index if not exists plan_desires_plan_user_unique
  on public.plan_desires (plan_id, user_id);

create unique index if not exists event_ratings_event_user_unique
  on public.event_ratings (plan_event_id, user_id);

alter table public.plan_desires enable row level security;
alter table public.event_ratings enable row level security;

-- Replace rating policies so raw rows are visible and editable only by their
-- author. Group-wide values are available only through aggregate functions.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('plan_desires', 'event_ratings')
  loop
    execute format(
      'drop policy %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end
$$;

create policy "Users read own plan desires"
on public.plan_desires for select
to authenticated
using (user_id = auth.uid());

create policy "Group members create own plan desires"
on public.plan_desires for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.plans plan
    join public.group_members member on member.group_id = plan.group_id
    where plan.id = plan_desires.plan_id
      and member.user_id = auth.uid()
  )
);

create policy "Users update own plan desires"
on public.plan_desires for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users delete own plan desires"
on public.plan_desires for delete
to authenticated
using (user_id = auth.uid());

create policy "Users read own event ratings"
on public.event_ratings for select
to authenticated
using (user_id = auth.uid());

create policy "Group members create own event ratings"
on public.event_ratings for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.plan_events event
    join public.plans plan on plan.id = event.plan_id
    join public.group_members member on member.group_id = plan.group_id
    where event.id = event_ratings.plan_event_id
      and member.user_id = auth.uid()
  )
);

create policy "Users update own event ratings"
on public.event_ratings for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users delete own event ratings"
on public.event_ratings for delete
to authenticated
using (user_id = auth.uid());

create or replace function public.get_group_plan_desire_summaries(
  requested_group_id text
)
returns table (
  plan_id text,
  average_score numeric,
  rating_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select desire.plan_id::text, avg(desire.score)::numeric, count(*)
  from public.plan_desires desire
  join public.plans plan on plan.id = desire.plan_id
  where plan.group_id::text = requested_group_id
    and exists (
      select 1
      from public.group_members member
      where member.group_id::text = requested_group_id
        and member.user_id = auth.uid()
    )
  group by desire.plan_id;
$$;

create or replace function public.get_group_event_rating_summaries(
  requested_group_id text
)
returns table (
  plan_event_id text,
  average_score numeric,
  rating_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select rating.plan_event_id::text, avg(rating.score)::numeric, count(*)
  from public.event_ratings rating
  join public.plan_events event on event.id = rating.plan_event_id
  join public.plans plan on plan.id = event.plan_id
  where plan.group_id::text = requested_group_id
    and exists (
      select 1
      from public.group_members member
      where member.group_id::text = requested_group_id
        and member.user_id = auth.uid()
    )
  group by rating.plan_event_id;
$$;

revoke all on function public.get_group_plan_desire_summaries(text) from public;
revoke all on function public.get_group_event_rating_summaries(text) from public;
grant execute on function public.get_group_plan_desire_summaries(text) to authenticated;
grant execute on function public.get_group_event_rating_summaries(text) to authenticated;

commit;
