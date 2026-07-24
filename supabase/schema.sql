-- Ringside Archive v5.1 cloud schema
-- Run this once in Supabase Dashboard -> SQL Editor.

create table if not exists public.archive_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.archive_state enable row level security;
revoke all on table public.archive_state from anon;
grant select, insert, update on table public.archive_state to authenticated;

-- Each signed-in user may only access the row whose user_id matches the
-- authenticated JWT. The integration vault below is never exposed to browsers.
drop policy if exists "Users can read their archive state" on public.archive_state;
create policy "Users can read their archive state"
on public.archive_state for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can insert their archive state" on public.archive_state;
create policy "Users can insert their archive state"
on public.archive_state for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can update their archive state" on public.archive_state;
create policy "Users can update their archive state"
on public.archive_state for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

-- Trakt and Plex credentials/snapshots are encrypted by Vercel before they reach
-- this table. No anon/authenticated grants or policies are created. Only the
-- server-side Supabase secret/service-role key can access these rows.
create table if not exists public.integration_vault (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('trakt', 'plex')),
  encrypted_payload text not null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.integration_vault enable row level security;
revoke all on table public.integration_vault from anon, authenticated;
grant select, insert, update, delete on table public.integration_vault to service_role;

create index if not exists archive_state_updated_at_idx on public.archive_state(updated_at desc);
create index if not exists integration_vault_updated_at_idx on public.integration_vault(updated_at desc);
