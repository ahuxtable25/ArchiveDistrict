-- ArchiveDistrict — Supabase Schema
-- Run this entire file in the Supabase SQL Editor (one paste, one click)

-- 1. Create the app_state table (single row stores entire app state)
create table if not exists app_state (
  id          integer primary key default 1,
  listings    jsonb   not null default '[]'::jsonb,
  stock_data  jsonb   not null default '[]'::jsonb,
  goals       jsonb   not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 2. Enforce single-row constraint
create unique index if not exists app_state_singleton on app_state (id);

-- 3. Insert the one row (safe to run multiple times)
insert into app_state (id, listings, stock_data, goals)
values (1, '[]', '[]', '{}')
on conflict (id) do nothing;

-- 4. Row Level Security — allow all operations (private app, no user auth needed)
alter table app_state enable row level security;

drop policy if exists "Allow all operations" on app_state;
create policy "Allow all operations"
  on app_state for all
  using (true)
  with check (true);

-- 5. Enable Realtime so all devices get instant updates
alter publication supabase_realtime add table app_state;
