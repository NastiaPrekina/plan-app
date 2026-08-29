-- Run this file manually in the Supabase SQL editor before using group rename.
-- The repository did not contain an UPDATE policy for public.groups.

begin;

alter table public.groups enable row level security;

drop policy if exists "Owners update their groups" on public.groups;
create policy "Owners update their groups"
on public.groups for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

commit;
