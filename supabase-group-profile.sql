-- Run this file manually in the Supabase SQL editor.
-- It keeps profiles private and exposes group participants only to members of
-- the same group. No column changes are needed: profiles.display_name exists.

begin;

alter table public.profiles enable row level security;
alter table public.group_members enable row level security;

-- This helper runs as its owner and therefore does not recursively invoke the
-- group_members RLS policy that calls it.
create or replace function public.is_group_member(requested_group_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members member
    where member.group_id::text = requested_group_id
      and member.user_id = auth.uid()
  );
$$;

revoke all on function public.is_group_member(text) from public;
grant execute on function public.is_group_member(text) to authenticated;

-- Replace existing read policies only. Mutation policies used by group
-- creation and invitation flows remain untouched.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'group_members')
      and cmd = 'SELECT'
  loop
    execute format(
      'drop policy %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end
$$;

-- Keep direct profile access limited to the current user. The group screen
-- receives other members through the aggregate-style RPC below, not by reading
-- arbitrary rows from profiles.
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "Users create own profile" on public.profiles;
create policy "Users create own profile"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- The app needs the current user's membership to discover their active group.
-- This predicate reads only columns from the current row and is non-recursive.
drop policy if exists "Users read own memberships" on public.group_members;
create policy "Users read own memberships"
on public.group_members for select
to authenticated
using (user_id = auth.uid());

create or replace function public.get_group_members_with_profiles(
  requested_group_id text
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  joined_at text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    member.user_id,
    coalesce(profile.email, '')::text,
    coalesce(profile.display_name, '')::text,
    member.role::text,
    member.joined_at::text
  from public.group_members member
  left join public.profiles profile on profile.id = member.user_id
  where member.group_id::text = requested_group_id
    and public.is_group_member(requested_group_id)
  order by
    case when member.role::text = 'owner' then 0 else 1 end,
    member.joined_at asc;
$$;

revoke all on function public.get_group_members_with_profiles(text) from public;
grant execute on function public.get_group_members_with_profiles(text) to authenticated;

commit;
