-- Run this migration manually in the Supabase SQL editor.
-- Stage 1: stores one Google Sheets integration per group.

begin;

create table if not exists public.group_integrations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  provider text not null,
  spreadsheet_id text not null,
  sheet_name text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_integrations_group_provider_key unique (group_id, provider),
  constraint group_integrations_provider_check check (provider = 'google_sheets')
);

alter table public.group_integrations enable row level security;

create or replace function public.is_integration_group_member(
  requested_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members member
    where member.group_id = requested_group_id
      and member.user_id = auth.uid()
  );
$$;

create or replace function public.is_integration_group_owner(
  requested_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members member
    where member.group_id = requested_group_id
      and member.user_id = auth.uid()
      and member.role::text = 'owner'
  );
$$;

revoke all on function public.is_integration_group_member(uuid) from public;
revoke all on function public.is_integration_group_owner(uuid) from public;
grant execute on function public.is_integration_group_member(uuid) to authenticated;
grant execute on function public.is_integration_group_owner(uuid) to authenticated;

create or replace function public.set_group_integration_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_group_integrations_updated_at
on public.group_integrations;

create trigger set_group_integrations_updated_at
before update on public.group_integrations
for each row execute function public.set_group_integration_updated_at();

drop policy if exists "Group members read integrations"
on public.group_integrations;
create policy "Group members read integrations"
on public.group_integrations for select
to authenticated
using (public.is_integration_group_member(group_id));

drop policy if exists "Group owners create integrations"
on public.group_integrations;
create policy "Group owners create integrations"
on public.group_integrations for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.is_integration_group_owner(group_id)
);

drop policy if exists "Group owners update integrations"
on public.group_integrations;
create policy "Group owners update integrations"
on public.group_integrations for update
to authenticated
using (public.is_integration_group_owner(group_id))
with check (public.is_integration_group_owner(group_id));

drop policy if exists "Group owners delete integrations"
on public.group_integrations;
create policy "Group owners delete integrations"
on public.group_integrations for delete
to authenticated
using (public.is_integration_group_owner(group_id));

grant select, insert, update, delete
on public.group_integrations to authenticated;

commit;
