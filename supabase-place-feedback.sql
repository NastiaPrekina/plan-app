-- Run this migration manually in the Supabase SQL editor.
-- It stores private, per-user reactions to catalog places.

begin;

create table if not exists public.place_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid not null references public.place_catalog(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_feedback_user_place_key unique (user_id, place_id),
  constraint place_feedback_reaction_check check (
    reaction in ('interested', 'not_interested', 'wishlist')
  )
);

create index if not exists place_feedback_user_reaction_idx
  on public.place_feedback (user_id, reaction);

create index if not exists place_feedback_place_id_idx
  on public.place_feedback (place_id);

create or replace function public.set_place_feedback_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_place_feedback_updated_at
on public.place_feedback;
create trigger set_place_feedback_updated_at
before update on public.place_feedback
for each row execute function public.set_place_feedback_updated_at();

alter table public.place_feedback enable row level security;

drop policy if exists "Users read own place feedback"
on public.place_feedback;
create policy "Users read own place feedback"
on public.place_feedback for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users create own place feedback"
on public.place_feedback;
create policy "Users create own place feedback"
on public.place_feedback for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users update own place feedback"
on public.place_feedback;
create policy "Users update own place feedback"
on public.place_feedback for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users delete own place feedback"
on public.place_feedback;
create policy "Users delete own place feedback"
on public.place_feedback for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete
on public.place_feedback to authenticated;

commit;
