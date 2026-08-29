-- Run this cleanup manually in the Supabase SQL editor.
-- These objects were created only for the discontinued Google Sheets integration.

begin;

drop table if exists public.group_integrations cascade;

drop function if exists public.is_integration_group_member(uuid);
drop function if exists public.is_integration_group_owner(uuid);
drop function if exists public.set_group_integration_updated_at();

commit;
