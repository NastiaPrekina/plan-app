-- Run this migration manually in the Supabase SQL editor.
-- It stores personal Google Calendar connections and server-only OAuth credentials.

begin;

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  calendar_id text not null default 'primary',
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  sync_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_connections
  add column if not exists status text not null default 'connected';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.google_calendar_connections'::regclass
      and conname = 'google_calendar_connections_status_check'
  ) then
    alter table public.google_calendar_connections
      add constraint google_calendar_connections_status_check
      check (status in ('connected', 'needs_reauth'));
  end if;
end
$$;

create table if not exists public.google_calendar_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  encryption_iv text not null,
  encryption_algorithm text not null default 'AES-GCM-256-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  -- Deliberately no FK: this identifier must survive deletion of plan_events
  -- until the next reconciliation removes the corresponding Google event.
  plan_event_id uuid not null,
  google_calendar_id text not null,
  google_event_id text not null,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_event_links_user_event_key
    unique (user_id, plan_event_id)
);

create table if not exists public.google_calendar_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_event_id uuid,
  operation text not null default 'reconcile_group',
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint google_calendar_sync_jobs_operation_check
    check (operation = 'reconcile_group'),
  constraint google_calendar_sync_jobs_status_check
    check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint google_calendar_sync_jobs_attempts_check
    check (attempts >= 0)
);

create unique index if not exists google_calendar_sync_jobs_pending_group_key
  on public.google_calendar_sync_jobs (group_id)
  where status = 'pending';

create index if not exists google_calendar_sync_jobs_claim_idx
  on public.google_calendar_sync_jobs (status, created_at)
  where status in ('pending', 'processing');

create index if not exists google_calendar_event_links_user_group_idx
  on public.google_calendar_event_links (user_id, group_id);

create or replace function public.set_google_calendar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_google_calendar_connections_updated_at
on public.google_calendar_connections;
create trigger set_google_calendar_connections_updated_at
before update on public.google_calendar_connections
for each row execute function public.set_google_calendar_updated_at();

drop trigger if exists set_google_calendar_credentials_updated_at
on public.google_calendar_credentials;
create trigger set_google_calendar_credentials_updated_at
before update on public.google_calendar_credentials
for each row execute function public.set_google_calendar_updated_at();

drop trigger if exists set_google_calendar_event_links_updated_at
on public.google_calendar_event_links;
create trigger set_google_calendar_event_links_updated_at
before update on public.google_calendar_event_links
for each row execute function public.set_google_calendar_updated_at();

drop trigger if exists set_google_calendar_sync_jobs_updated_at
on public.google_calendar_sync_jobs;
create trigger set_google_calendar_sync_jobs_updated_at
before update on public.google_calendar_sync_jobs
for each row execute function public.set_google_calendar_updated_at();

create or replace function public.enqueue_google_calendar_group_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_plan_id uuid;
  target_group_id uuid;
  target_plan_event_id uuid;
begin
  target_plan_id := case when tg_op = 'DELETE' then old.plan_id else new.plan_id end;
  target_plan_event_id := case when tg_op = 'DELETE' then old.id else new.id end;

  select plan.group_id into target_group_id
  from public.plans plan
  where plan.id = target_plan_id;

  if target_group_id is not null then
    insert into public.google_calendar_sync_jobs (
      group_id,
      plan_event_id,
      operation,
      status
    ) values (
      target_group_id,
      target_plan_event_id,
      'reconcile_group',
      'pending'
    )
    on conflict (group_id) where status = 'pending' do nothing;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists enqueue_google_calendar_group_sync
on public.plan_events;
create trigger enqueue_google_calendar_group_sync
after insert or update or delete on public.plan_events
for each row execute function public.enqueue_google_calendar_group_sync();

create or replace function public.claim_google_calendar_sync_jobs(
  requested_limit integer default 10
)
returns setof public.google_calendar_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimable as (
    select job.id
    from public.google_calendar_sync_jobs job
    where job.attempts < 5
      and (
        job.status = 'pending'
        or (
          job.status = 'processing'
          and job.updated_at < now() - interval '10 minutes'
        )
      )
      and not exists (
        select 1
        from public.google_calendar_sync_jobs active_job
        where active_job.group_id = job.group_id
          and active_job.id <> job.id
          and active_job.status = 'processing'
          and active_job.updated_at >= now() - interval '10 minutes'
      )
    order by job.created_at
    for update skip locked
    limit greatest(1, least(coalesce(requested_limit, 10), 50))
  )
  update public.google_calendar_sync_jobs job
  set status = 'processing',
      attempts = job.attempts + 1,
      last_error = null,
      processed_at = null
  from claimable
  where job.id = claimable.id
  returning job.*;
end;
$$;

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_credentials enable row level security;
alter table public.google_calendar_event_links enable row level security;
alter table public.google_calendar_sync_jobs enable row level security;

drop policy if exists "Users read own Google Calendar connection"
on public.google_calendar_connections;
create policy "Users read own Google Calendar connection"
on public.google_calendar_connections for select
to authenticated
using (user_id = auth.uid());

-- Connection changes, encrypted credentials and event mappings are managed
-- only by the Edge Function with SUPABASE_SERVICE_ROLE_KEY.
revoke all on public.google_calendar_connections from anon, authenticated;
grant select on public.google_calendar_connections to authenticated;

revoke all on public.google_calendar_credentials from anon, authenticated;
revoke all on public.google_calendar_event_links from anon, authenticated;
revoke all on public.google_calendar_sync_jobs from anon, authenticated;

revoke all on function public.enqueue_google_calendar_group_sync() from public;
revoke all on function public.claim_google_calendar_sync_jobs(integer) from public;
grant execute on function public.claim_google_calendar_sync_jobs(integer)
to service_role;

commit;

-- Configure Supabase Cron separately after deploying the Edge Function.
-- The scheduled HTTP request should POST every 1-5 minutes to:
-- https://<PROJECT_REF>.supabase.co/functions/v1/google-calendar-integration
-- Body: {"action":"process_sync_jobs"}
-- Header: x-google-calendar-worker-secret: <GOOGLE_CALENDAR_WORKER_SECRET>
